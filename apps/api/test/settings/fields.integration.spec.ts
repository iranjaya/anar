import { createTenantDb, fields, type TenantDb } from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFields } from "../../src/modules/settings/index.js";
import type { Ctx } from "../../src/modules/tenant/index.js";
import { publicOrigin } from "../auth/fixture.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

type Target = { agencyId: string; companyId: string };

describe("a manager adds a custom field", () => {
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

  const dropdown = {
    label: "Apartment type",
    type: "dropdown",
    options: [
      { value: "2_bhk", label: "2 BHK" },
      { value: "3_bhk", label: "3 BHK" },
    ],
  };
  const create = (
    slug: string,
    cookie: string,
    payload: object,
    origin = publicOrigin,
    index = 0,
  ) =>
    fixture.apps[index].app.inject({
      method: "POST",
      url: `/api/companies/${slug}/settings/createField`,
      payload,
      headers: { origin, cookie },
    });
  const stored = (target: Target) =>
    tenantDb.withTenant({ ...target, userId: v7() }, (scoped) =>
      scoped
        .select({ key: fields.key, position: fields.position })
        .from(fields)
        .where(eq(fields.isSystem, false)),
    );
  const audits = () =>
    fixture.rows<{ target_id: string; data: { fieldId: string } }>(
      sql`select target_id, data from audit_log where action = 'settings.field_created' order by created_at, id`,
    );
  async function setup() {
    const base = await fixture.setup();
    const users = [];
    for (const role of ["super_admin", "super_admin", "admin"] as const) {
      const user = await fixture.seedUser();
      const member = await fixture.seedMember(base.a, user.id, "active", role);
      users.push({ ...(await fixture.loginAs(user)), user, member });
    }
    const [manager, second, seller] = users;
    return { ...base, manager, second, seller, slug: base.a.company.slug };
  }

  it("adds a dropdown with a key made from its name, after the defaults", async () => {
    const { a, manager, slug } = await setup();
    const response = await create(slug, manager.cookie, dropdown);
    expect(response.statusCode).toBe(200);
    const { fieldId } = response.json().data;
    expect((await stored(a)).at(-1)).toEqual({
      key: "apartment_type",
      position: 3,
    });
    expect(await audits()).toEqual([{ target_id: fieldId, data: { fieldId } }]);
  });

  it("refuses a key that exists, archived or not, and a name with no usable key", async () => {
    const { a, manager, slug } = await setup();
    await tenantDb.withTenant({ ...a, userId: v7() }, (scoped) =>
      scoped
        .update(fields)
        .set({ archivedAt: fixture.now() })
        .where(eq(fields.key, "budget_fit")),
    );
    for (const key of ["budget_fit", "decision_maker"]) {
      const response = await create(slug, manager.cookie, {
        ...dropdown,
        key,
      });
      expect(response.statusCode).toBe(409);
    }
    const unnamed = await create(slug, manager.cookie, {
      label: "बजेट",
      type: "text",
    });
    expect(unnamed.statusCode).toBe(400);
    expect(await audits()).toEqual([]);
  });

  it("lets only one of two managers add the same key at once", async () => {
    const { manager, second, slug } = await setup();
    const responses = await Promise.all([
      create(slug, manager.cookie, dropdown, publicOrigin, 0),
      create(slug, second.cookie, dropdown, publicOrigin, 1),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    expect(await audits()).toHaveLength(1);
  });

  it("needs a code from the last 15 minutes and the same origin", async () => {
    const { a, manager, seller, slug } = await setup();
    expect(
      (await create(slug, manager.cookie, dropdown, "https://hostile.example"))
        .statusCode,
    ).toBe(403);
    expect((await create(slug, seller.cookie, dropdown)).statusCode).toBe(403);
    fixture.advance(900000);
    expect((await create(slug, manager.cookie, dropdown)).statusCode).toBe(200);
    fixture.advance(1);
    const stale = await create(slug, manager.cookie, {
      ...dropdown,
      key: "second",
    });
    expect(stale.statusCode).toBe(428);
    expect(stale.json()).toMatchObject({ error: "step_up_required" });
    expect((await stored(a)).map((row) => row.key)).not.toContain("second");
  });

  it("keeps no field when its audit cannot be written", async () => {
    const { a, manager, slug } = await setup();
    await fixture.owner("REVOKE INSERT ON audit_log FROM anar_app");
    try {
      expect((await create(slug, manager.cookie, dropdown)).statusCode).toBe(
        500,
      );
    } finally {
      await fixture.owner("GRANT INSERT ON audit_log TO anar_app");
    }
    expect(await stored(a)).toHaveLength(3);
  });

  it("writes a whole import batch or nothing", async () => {
    const { a, manager } = await setup();
    const current = {
      ...manager.member,
      role: "super_admin",
      member: manager.member,
      agencyId: a.agencyId,
      companyId: a.companyId,
      superAdminCanImport: false,
      user: manager.user,
      session: { lastOtpAt: fixture.now() },
    } as unknown as Ctx;
    const batch = (second: string) =>
      tenantDb.withTenant({ ...a, userId: manager.user.id }, (scoped) =>
        createFields(
          scoped,
          current,
          [
            { key: "notes", label: "Notes", type: "text" },
            { key: second, label: "Second", type: "number" },
          ],
          { at: fixture.now(), ip: null },
        ),
      );
    await expect(batch("budget_fit")).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(batch("notes")).rejects.toMatchObject({ code: "conflict" });
    expect(await stored(a)).toHaveLength(3);
    const rows = await batch("budget_npr");
    expect(rows.map((row) => [row.key, row.position])).toEqual([
      ["notes", 3],
      ["budget_npr", 4],
    ]);
  });
});
