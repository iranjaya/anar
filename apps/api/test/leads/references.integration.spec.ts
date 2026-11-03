import {
  createTenantDb,
  leads,
  stages,
  type TenantDb,
  type TenantTx,
} from "@anar/db/tenant";
import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getMemberLeadCounts,
  getMemberOpenLeadCount,
  getReferenceCounts,
} from "../../src/modules/leads/index.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

type Target = { agencyId: string; companyId: string };

describe("lead reference counts see only kept rows of the scoped company", () => {
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
  async function seedStage(target: Target, kind: "open" | "won", name: string) {
    const id = v7();
    await scoped(target, (tx) =>
      tx.insert(stages).values({
        id,
        companyId: target.companyId,
        name,
        position: 20,
        kind,
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
      phoneValid: false,
      sourceKind: "import",
      leadDate: fixture.now(),
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

  async function setup() {
    const base = await fixture.setup();
    const user = await fixture.seedUser();
    const seller = await fixture.seedMember(base.a, user.id, "active", "admin");
    const open = await seedStage(base.a, "open", "Test open");
    const won = await seedStage(base.a, "won", "Test won");
    return { ...base, seller, open, won };
  }

  it("counts zero and empty answers as used, but not null or missing ones", async () => {
    const { a, open } = await setup();
    const kept = lead(a, open, { custom: { budget_fit: "Yes" } });
    await insert(a, [
      kept,
      lead(a, open, { custom: { budget_fit: 0 } }),
      lead(a, open, { custom: { budget_fit: "" } }),
      lead(a, open, { custom: { budget_fit: null } }),
      lead(a, open, { custom: { decision_maker: "Yes" } }),
    ]);
    await insert(a, [
      lead(a, open, {
        custom: { budget_fit: "Maybe" },
        mergedIntoId: kept.id,
      }),
      lead(a, open, {
        custom: { budget_fit: "Yes" },
        deletedAt: fixture.now(),
      }),
    ]);
    const counts = await scoped(a, (tx) =>
      getReferenceCounts(tx, { kind: "field", fieldKey: "budget_fit" }),
    );
    expect(counts).toEqual({ leadCount: 5 });
  });

  it("counts every lead on a stage, merged and deleted ones too", async () => {
    const { a, open, won } = await setup();
    const kept = lead(a, open);
    await insert(a, [kept, lead(a, won)]);
    await insert(a, [
      lead(a, open, { mergedIntoId: kept.id }),
      lead(a, open, { deletedAt: fixture.now() }),
    ]);
    const counts = await scoped(a, (tx) =>
      Promise.all([
        getReferenceCounts(tx, { kind: "stage", stageId: open }),
        getReferenceCounts(tx, { kind: "stage", stageId: won }),
        getReferenceCounts(tx, { kind: "stage", stageId: v7() }),
      ]),
    );
    expect(counts).toEqual([
      { leadCount: 3 },
      { leadCount: 1 },
      { leadCount: 0 },
    ]);
  });

  it("counts a member's open and overdue leads, skipping closed, merged and deleted ones", async () => {
    const { a, seller, open, won } = await setup();
    const at = fixture.now();
    const past = new Date(at.getTime() - 60_000);
    const future = new Date(at.getTime() + 60_000);
    const assigned = { assignedTo: seller.id };
    const kept = lead(a, open, { ...assigned, nextActionAt: future });
    await insert(a, [
      kept,
      lead(a, open, { ...assigned, nextActionAt: past }),
      lead(a, open, assigned),
      lead(a, won, { ...assigned, nextActionAt: past }),
      lead(a, open, { nextActionAt: past }),
    ]);
    await insert(a, [
      lead(a, open, { ...assigned, nextActionAt: past, mergedIntoId: kept.id }),
      lead(a, open, { ...assigned, nextActionAt: past, deletedAt: at }),
    ]);
    const counts = await scoped(a, (tx) =>
      Promise.all([
        getMemberLeadCounts(tx, seller.id, at),
        getMemberOpenLeadCount(tx, seller.id),
      ]),
    );
    expect(counts).toEqual([{ openLeads: 3, overdue: 1 }, 3]);
  });

  it("hides one company's leads from another company and refuses to run unscoped", async () => {
    const { a, b, open } = await setup();
    await insert(a, [lead(a, open)]);
    const foreign = await scoped(b, (tx) =>
      getReferenceCounts(tx, { kind: "stage", stageId: open }),
    );
    expect(foreign).toEqual({ leadCount: 0 });
    await expect(
      fixture.db.transaction((tx) =>
        getReferenceCounts(tx, { kind: "stage", stageId: open }),
      ),
    ).rejects.toThrow("Company scope is required");
  });

  it("refuses a lead that points at another company's stage or member", async () => {
    const { a, b, seller, open } = await setup();
    const foreignStage = await seedStage(b, "open", "Test open");
    await expect(insert(a, [lead(a, foreignStage)])).rejects.toMatchObject({
      cause: { code: "23503" },
    });
    await expect(
      insert(b, [lead(b, foreignStage, { assignedTo: seller.id })]),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(insert(b, [lead(b, open)])).rejects.toMatchObject({
      cause: { code: "23503" },
    });
  });

  it("gives the app no way to delete lead or settings rows", async () => {
    const rows = await fixture.rows<{
      table: string;
      del: boolean;
      trunc: boolean;
      forced: boolean;
    }>(
      sql`select c.relname as table,
        has_table_privilege(current_user, c.oid, 'DELETE') as del,
        has_table_privilege(current_user, c.oid, 'TRUNCATE') as trunc,
        c.relforcerowsecurity as forced
        from pg_class c
        where c.relnamespace = 'public'::regnamespace
        and c.relname in ('leads', 'fields', 'stages', 'outcomes', 'lost_reasons')
        order by c.relname`,
    );
    expect(rows).toEqual(
      ["fields", "leads", "lost_reasons", "outcomes", "stages"].map(
        (table) => ({
          table,
          del: false,
          trunc: false,
          forced: true,
        }),
      ),
    );
  });
});
