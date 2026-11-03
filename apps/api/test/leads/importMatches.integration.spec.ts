import {
  createTenantDb,
  leadEvents,
  leads,
  stages,
  type TenantDb,
  type TenantTx,
} from "@anar/db/tenant";
import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findImportMatches } from "../../src/modules/leads/index.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

type Target = { agencyId: string; companyId: string };

describe("import phone lookup sees only live leads of the scoped company", () => {
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

  const scoped = <T>(target: Target, fn: (tx: TenantTx) => Promise<T>) =>
    tenantDb.withTenant({ ...target, userId: v7() }, fn);
  async function seedStage(target: Target) {
    const id = v7();
    await scoped(target, (tx) =>
      tx.insert(stages).values({
        id,
        companyId: target.companyId,
        name: "Test open",
        position: 20,
        kind: "open",
        isDefault: false,
      }),
    );
    return id;
  }
  function lead(
    target: Target,
    stageId: string,
    overrides: Partial<typeof leads.$inferInsert> = {},
  ): typeof leads.$inferInsert {
    return {
      id: v7(),
      companyId: target.companyId,
      phoneValid: true,
      sourceKind: "import",
      leadDate: new Date("2026-03-04T05:06:07.008Z"),
      stageId,
      custom: {},
      score: 0,
      priority: "cold",
      scoreBreakdown: {},
      scoredAt: fixture.now(),
      ...overrides,
    };
  }
  const insert = (target: Target, rows: (typeof leads.$inferInsert)[]) =>
    scoped(target, (tx) => tx.insert(leads).values(rows));
  const lookup = (target: Target, phones: string[]) =>
    scoped(target, (tx) => findImportMatches(tx, { phones }));

  async function setup() {
    const base = await fixture.setup();
    return { ...base, stageA: await seedStage(base.a) };
  }

  it("returns the live lead with its exact campaign and date, once per phone", async () => {
    const { a, stageA } = await setup();
    const live = lead(a, stageA, {
      phoneE164: "+9779800000001",
      campaignName: "Spring open house",
    });
    const noCampaign = lead(a, stageA, { phoneE164: "+9779800000002" });
    await insert(a, [live, noCampaign]);
    const matches = await lookup(a, [
      "+9779800000001",
      "+9779800000002",
      "+9779800000001",
      "+9779800000009",
    ]);
    expect(
      matches.sort((x, y) => x.phoneE164.localeCompare(y.phoneE164)),
    ).toEqual([
      {
        leadId: live.id,
        phoneE164: "+9779800000001",
        campaignName: "Spring open house",
        leadDate: new Date("2026-03-04T05:06:07.008Z"),
      },
      {
        leadId: noCampaign.id,
        phoneE164: "+9779800000002",
        campaignName: null,
        leadDate: new Date("2026-03-04T05:06:07.008Z"),
      },
    ]);
  });

  it("skips merged and deleted leads", async () => {
    const { a, stageA } = await setup();
    const kept = lead(a, stageA, { phoneE164: "+9779800000001" });
    await insert(a, [kept]);
    await insert(a, [
      lead(a, stageA, { phoneE164: "+9779800000002", mergedIntoId: kept.id }),
      lead(a, stageA, {
        phoneE164: "+9779800000003",
        deletedAt: fixture.now(),
      }),
    ]);
    const matches = await lookup(a, ["+9779800000002", "+9779800000003"]);
    expect(matches).toEqual([]);
  });

  it("does not see the same phone in another company", async () => {
    const { a, b, stageA } = await setup();
    const stageB = await seedStage(b);
    const inA = lead(a, stageA, { phoneE164: "+9779800000001" });
    const inB = lead(b, stageB, { phoneE164: "+9779800000001" });
    await insert(a, [inA]);
    await insert(b, [inB]);
    expect((await lookup(a, ["+9779800000001"])).map((m) => m.leadId)).toEqual([
      inA.id,
    ]);
    expect((await lookup(b, ["+9779800000001"])).map((m) => m.leadId)).toEqual([
      inB.id,
    ]);
  });

  it("returns nothing for no phones and refuses a bad or unscoped lookup", async () => {
    const { a } = await setup();
    expect(await lookup(a, [])).toEqual([]);
    await expect(lookup(a, ["9800000001"])).rejects.toMatchObject({
      code: "validation",
    });
    await expect(
      fixture.db.transaction((tx) =>
        findImportMatches(tx, { phones: ["+9779800000001"] }),
      ),
    ).rejects.toThrow("Company scope is required");
  });

  it("refuses an event that points at another company's lead or member", async () => {
    const { a, b, owner, stageA } = await setup();
    const leadA = lead(a, stageA, { phoneE164: "+9779800000001" });
    await insert(a, [leadA]);
    const memberB = await fixture.seedMember(b, owner.user.id);
    const event = (
      target: Target,
      overrides: Partial<typeof leadEvents.$inferInsert> = {},
    ): typeof leadEvents.$inferInsert => ({
      id: v7(),
      companyId: target.companyId,
      leadId: leadA.id,
      type: "imported",
      actorUserId: owner.user.id,
      data: { batchId: v7(), rowNo: 1 },
      ...overrides,
    });
    await scoped(a, (tx) => tx.insert(leadEvents).values(event(a)));
    await expect(
      scoped(b, (tx) => tx.insert(leadEvents).values(event(b))),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(
      scoped(a, (tx) =>
        tx.insert(leadEvents).values(event(a, { actorMemberId: memberB.id })),
      ),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(
      scoped(a, (tx) =>
        tx
          .insert(leadEvents)
          .values(event(a, { type: "invalid" as "imported" })),
      ),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("gives the app no way to delete lead events and forces RLS", async () => {
    const rows = await fixture.rows<{
      del: boolean;
      trunc: boolean;
      forced: boolean;
    }>(
      sql`select has_table_privilege(current_user, c.oid, 'DELETE') as del,
        has_table_privilege(current_user, c.oid, 'TRUNCATE') as trunc,
        c.relforcerowsecurity as forced
        from pg_class c
        where c.relnamespace = 'public'::regnamespace
        and c.relname = 'lead_events'`,
    );
    expect(rows).toEqual([{ del: false, trunc: false, forced: true }]);
  });
});
