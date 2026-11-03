import {
  createTenantDb,
  scoringConfigs,
  type TenantDb,
  type TenantTx,
} from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import context from "../../src/modules/agencies/context.js";
import companyService from "../../src/modules/companies/service.js";
import {
  loadActiveConfig,
  scoreLead,
  seedScoringDefaults,
} from "../../src/modules/scoring/index.js";
import { loadSchema } from "../../src/modules/settings/index.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

type Company = {
  agencyId: string;
  companyId: string;
  company: { slug: string };
};

describe("new companies get scoring version 1", () => {
  let fixture: CompanyFixture;
  let tenantDb: TenantDb;
  beforeAll(async () => {
    fixture = await startCompanyFixture();
    tenantDb = await createTenantDb(fixture.postgres.appUrl);
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await tenantDb?.close();
    await fixture?.close();
  });

  const scoped = <T>(
    target: Company,
    fn: (tx: TenantTx) => Promise<T>,
    userId = v7(),
  ) =>
    tenantDb.withTenant(
      { agencyId: target.agencyId, companyId: target.companyId, userId },
      fn,
    );
  const configs = (target: Company) =>
    scoped(target, (tx) => tx.select().from(scoringConfigs));
  const read = (slug: string, cookie: string) =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/scoring/getScoringDefaults`,
      headers: { cookie },
    });
  async function companyUser(
    target: Company,
    role: "super_admin" | "admin",
    ip: string,
  ) {
    const user = await fixture.seedUser();
    await fixture.seedMember(target, user.id, "active", role);
    return fixture.loginAs(user, { ip });
  }

  it("stores one active version 1 made by the staff who created the company", async () => {
    const { a } = await fixture.setup();
    const rows = await configs(a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: 1,
      basePoints: 1,
      warmMin: 5,
      hotMin: 8,
      active: true,
      createdBy: a.user.id,
    });
  });

  it("scores with the codes the settings seed stored", async () => {
    const { a } = await fixture.setup();
    const result = await scoped(a, async (tx) => {
      const schema = await loadSchema(tx);
      const code = (key: string, value: string) => {
        const option = schema.fields
          .find((field) => field.key === key)
          ?.options?.find((o) => o.value === value);
        if (!option) throw new Error(`Missing ${key} ${value}`);
        return option.value;
      };
      return scoreLead(
        {
          custom: {
            purchase_timeline: code("purchase_timeline", "within_1_month"),
            budget_fit: code("budget_fit", "Yes"),
          },
        },
        await loadActiveConfig(tx),
      );
    });
    expect(result).toEqual({
      score: 8,
      priority: "hot",
      breakdown: { base: 1, purchase_timeline: 4, budget_fit: 3 },
    });
  });

  it("does nothing on a repeat or a concurrent seed", async () => {
    const { a } = await fixture.setup();
    await Promise.all(
      Array.from({ length: 3 }, () => scoped(a, seedScoringDefaults)),
    );
    await scoped(a, seedScoringDefaults);
    expect(await configs(a)).toHaveLength(1);
  });

  it("refuses to seed when version 1 exists but is not active", async () => {
    const { a } = await fixture.setup();
    await scoped(a, (tx) => tx.update(scoringConfigs).set({ active: false }));
    await expect(scoped(a, seedScoringDefaults)).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(scoped(a, loadActiveConfig)).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("rolls back the company when the scoring fields are missing", async () => {
    const { a } = await fixture.setup();
    const service = companyService.create({
      context: context.create({
        db: fixture.db,
        sessions: fixture.apps[0].sessions,
      }),
      now: fixture.now,
      createCompanyInvite: fixture.invitations.createCompanyInvite,
      seedCompany: seedScoringDefaults,
    });
    const before = await fixture.rows<{ count: number }>(
      sql`select count(*)::int as count from audit_log where action = 'company.created'`,
    );
    const actor = await service.requireAgencyContext({
      headers: { cookie: a.cookie },
    });
    await expect(
      service.createCompany(
        actor,
        {
          name: "No fields",
          slug: `no-fields-${v7()}`,
          defaultCountry: "NP",
          timezone: "Asia/Kathmandu",
        },
        { ip: "198.51.100.93" },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const companies = await fixture.companyRequest(
      "GET",
      "listCompanies",
      a.cookie,
    );
    expect(
      (companies.json().data.items as { name: string }[]).map((c) => c.name),
    ).not.toContain("No fields");
    expect(
      await fixture.rows<{ count: number }>(
        sql`select count(*)::int as count from audit_log where action = 'company.created'`,
      ),
    ).toEqual(before);
  });

  it("shows the defaults to managers only, without a fresh code", async () => {
    const { a, b } = await fixture.setup();
    const manager = await companyUser(a, "super_admin", "198.51.100.91");
    const seller = await companyUser(a, "admin", "198.51.100.92");
    fixture.advance(16 * 60 * 1000);
    const ok = await read(a.company.slug, manager.cookie);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({
      companyId: a.companyId,
      version: 1,
      hotMin: 8,
    });
    expect((await read(a.company.slug, seller.cookie)).statusCode).toBe(403);
    expect((await read(b.company.slug, manager.cookie)).statusCode).toBe(404);
  });

  it("keeps each company's config to its own scope", async () => {
    const { a, b } = await fixture.setup();
    const [own] = await configs(a);
    const seen = await scoped(b, (tx) =>
      tx.select().from(scoringConfigs).where(eq(scoringConfigs.id, own.id)),
    );
    expect(seen).toHaveLength(0);
  });
});
