import {
  createTenantDb,
  fields,
  lostReasons,
  outcomes,
  stages,
  type TenantDb,
  type TenantTx,
} from "@anar/db/tenant";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadSchema, seedDefaults } from "../../src/modules/settings/index.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

type Target = { agencyId: string; companyId: string };

describe("a new company gets its own default settings", () => {
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
  const counts = (target: Target) =>
    scoped(target, async (tx) => ({
      stages: (await tx.select().from(stages)).length,
      outcomes: (await tx.select().from(outcomes)).length,
      lostReasons: (await tx.select().from(lostReasons)).length,
      fields: (await tx.select().from(fields)).length,
    }));
  const read = (slug: string, cookie: string, operation: string) =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/settings/${operation}`,
      headers: { cookie },
    });
  async function companyUser(target: Target, role: "super_admin" | "admin") {
    const user = await fixture.seedUser();
    await fixture.seedMember(target, user.id, "active", role);
    return fixture.loginAs(user);
  }

  it("creates 8 stages, 10 outcomes, 7 lost reasons and 3 fields with the company", async () => {
    const { a } = await fixture.setup();
    expect(await counts(a)).toEqual({
      stages: 8,
      outcomes: 10,
      lostReasons: 7,
      fields: 3,
    });
    const schema = await scoped(a, loadSchema);
    expect(schema.stages.filter((stage) => stage.isDefault)).toEqual([
      expect.objectContaining({ name: "New Lead", kind: "open", position: 0 }),
    ]);
    expect(schema.fields.map((field) => field.key)).toEqual([
      "purchase_timeline",
      "budget_fit",
      "decision_maker",
    ]);
  });

  it("seeds again without adding rows or undoing edits", async () => {
    const { a } = await fixture.setup();
    await scoped(a, async (tx) => {
      await tx
        .update(stages)
        .set({ name: "Fresh" })
        .where(eq(stages.name, "New Lead"));
      await tx
        .update(outcomes)
        .set({ countsAsFailed: false })
        .where(eq(outcomes.name, "No Answer"));
      await tx
        .update(lostReasons)
        .set({ archivedAt: fixture.now() })
        .where(eq(lostReasons.name, "Other"));
      await tx
        .update(fields)
        .set({
          label: "Budget",
          options: [
            { value: "Yes", label: "Yes" },
            { value: "Maybe", label: "Maybe" },
            { value: "No", label: "No" },
          ],
        })
        .where(eq(fields.key, "budget_fit"));
    });
    await scoped(a, seedDefaults);
    await scoped(a, seedDefaults);
    expect(await counts(a)).toEqual({
      stages: 8,
      outcomes: 10,
      lostReasons: 7,
      fields: 3,
    });
    const schema = await scoped(a, loadSchema);
    expect(schema.stages[0]).toMatchObject({ name: "Fresh", isDefault: true });
    expect(
      schema.outcomes.find((outcome) => outcome.name === "No Answer"),
    ).toMatchObject({ countsAsFailed: false });
    expect(schema.lostReasons.map((reason) => reason.name)).not.toContain(
      "Other",
    );
    expect(
      schema.fields.find((field) => field.key === "budget_fit"),
    ).toMatchObject({ label: "Budget" });
  });

  it("refuses to seed over a default field whose codes were removed", async () => {
    const { a } = await fixture.setup();
    await scoped(a, (tx) =>
      tx
        .update(fields)
        .set({ options: [{ value: "Yes", label: "Yes" }] })
        .where(eq(fields.key, "budget_fit")),
    );
    await expect(scoped(a, seedDefaults)).rejects.toMatchObject({
      code: "conflict",
    });
    expect((await counts(a)).fields).toBe(3);
  });

  it("keeps each company's settings apart and refuses to read unscoped", async () => {
    const { a, b } = await fixture.setup();
    const [first, second] = await Promise.all([
      scoped(a, loadSchema),
      scoped(b, loadSchema),
    ]);
    expect(first.stages.every((stage) => stage.companyId === a.companyId)).toBe(
      true,
    );
    expect(
      second.stages.every((stage) => stage.companyId === b.companyId),
    ).toBe(true);
    await expect(
      fixture.db.transaction((tx) => loadSchema(tx)),
    ).rejects.toThrow("Company scope is required");
  });

  it("lets a manager read the catalog and an Admin only the active choices", async () => {
    const { a, b } = await fixture.setup();
    const slug = a.company.slug;
    const manager = await companyUser(a, "super_admin");
    const seller = await companyUser(a, "admin");
    const foreign = await companyUser(b, "super_admin");

    const catalog = await read(slug, manager.cookie, "getSettings");
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().data.stages).toHaveLength(8);
    expect(catalog.json().data.stages[0].archivedAt).toBeNull();

    expect((await read(slug, seller.cookie, "getSettings")).statusCode).toBe(
      403,
    );
    const choices = await read(slug, seller.cookie, "loadSchema");
    expect(choices.statusCode).toBe(200);
    expect(choices.json().data.outcomes).toHaveLength(10);

    for (const operation of ["getSettings", "loadSchema"])
      expect((await read(slug, foreign.cookie, operation)).statusCode).toBe(
        404,
      );
  });
});
