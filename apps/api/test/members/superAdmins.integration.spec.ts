import { createTenantDb, type TenantDb } from "@anar/db/tenant";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import members from "../../src/modules/members/service.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

describe("listing a company's Super Admins for a job", () => {
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

  it("returns only active Super Admins of the scoped company", async () => {
    const { a, b } = await fixture.setup();
    const seed = async (
      target: typeof a,
      status: "active" | "deactivated" | "invited",
      role: "super_admin" | "admin",
    ) => {
      const user = await fixture.seedUser();
      await fixture.seedMember(target, user.id, status, role);
      return user.id;
    };
    const active = await seed(a, "active", "super_admin");
    await seed(a, "deactivated", "super_admin");
    await seed(a, "invited", "super_admin");
    await seed(a, "active", "admin");
    await seed(b, "active", "super_admin");
    const ids = await tenantDb.withTenant(
      { agencyId: a.agencyId, companyId: a.companyId, userId: v7() },
      (tx) => members.listSuperAdminUserIds(tx),
    );
    expect(ids).toEqual([active]);
  });
});
