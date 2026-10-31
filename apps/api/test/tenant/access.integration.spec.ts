import { companies, withPlatformTenant } from "@anar/db/platform";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { publicOrigin } from "../auth/fixture.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

const manager = [
  "members.invite_admin",
  "members.deactivate",
  "members.list",
  "settings.manage",
  "leads.assign",
  "leads.bulk",
  "leads.merge",
  "leads.export",
  "leads.view",
  "leads.update",
  "followups.log",
  "reports.view_all",
  "reports.compare",
  "reports.view_own",
  "sessions.manage_own",
];
const admin = [
  "leads.view",
  "leads.update",
  "followups.log",
  "reports.view_own",
  "sessions.manage_own",
];

describe("role and tenant policy over HTTP", () => {
  let fixture: CompanyFixture;
  beforeAll(async () => {
    fixture = await startCompanyFixture();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  const context = (
    slug: string,
    cookie: string,
    headers: Record<string, string> = {},
  ) =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/context?company=${slug}`,
      headers: { ...headers, cookie },
    });
  async function companyUser(
    target: { agencyId: string; companyId: string },
    role: "super_admin" | "admin",
    ip: string,
  ) {
    const user = await fixture.seedUser();
    await fixture.seedMember(target, user.id, "active", role);
    return fixture.loginAs(user, { ip });
  }
  async function setup() {
    const base = await fixture.setup();
    const a2 = await fixture.createCompany(base.a.cookie);
    const b2 = await fixture.createCompany(base.b.cookie);
    const superAdmin = await companyUser(
      base.a,
      "super_admin",
      "198.51.100.95",
    );
    const member = await companyUser(base.a, "admin", "198.51.100.96");
    return { ...base, a2, b2, superAdmin, member };
  }
  const missing = () => v7();

  it("lets only the owner reach the agency registry", async () => {
    const { owner, a, superAdmin, member } = await setup();
    expect(
      (await fixture.request("GET", "listAgencies", owner.cookie)).statusCode,
    ).toBe(200);
    for (const cookie of [a.cookie, superAdmin.cookie, member.cookie]) {
      expect(
        (await fixture.request("GET", "listAgencies", cookie)).statusCode,
      ).toBe(403);
      expect(
        (await fixture.request("POST", "createAgency", cookie, fixture.input()))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await fixture.request("POST", "resendFirstInvite", cookie, {
            agencyId: a.agencyId,
          })
        ).statusCode,
      ).toBe(403);
    }
  });

  it("lets only own agency staff reach staff and company routes", async () => {
    const { owner, a, superAdmin, member } = await setup();
    for (const cookie of [owner.cookie, superAdmin.cookie, member.cookie]) {
      for (const path of ["getAgency", "listStaff", "listInvites"])
        expect((await fixture.request("GET", path, cookie)).statusCode).toBe(
          403,
        );
      expect(
        (
          await fixture.request("POST", "inviteStaff", cookie, {
            email: `${v7()}@example.test`,
            name: "Colleague",
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await fixture.companyRequest("GET", "listCompanies", cookie))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await fixture.companyRequest("POST", "createCompany", cookie, {
            name: "Forbidden company",
            slug: `forbidden-${v7()}`,
            defaultCountry: "NP",
            timezone: "Asia/Kathmandu",
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await fixture.companyRequest(
            "POST",
            "inviteSuperAdmin",
            cookie,
            fixture.companyInput(a.companyId),
          )
        ).statusCode,
      ).toBe(403);
    }
  });

  it("keeps staff to their own agency's companies and invites", async () => {
    const { a, b, a2, b2 } = await setup();
    const listed = await fixture.companyRequest(
      "GET",
      "listCompanies",
      a.cookie,
    );
    expect(
      listed
        .json()
        .data.items.map((item: { id: string }) => item.id)
        .sort(),
    ).toEqual([a.companyId, a2.id].sort());
    const invite = (companyId: string) =>
      fixture.companyRequest(
        "POST",
        "inviteSuperAdmin",
        a.cookie,
        fixture.companyInput(companyId),
      );
    expect((await invite(a.companyId)).statusCode).toBe(200);
    expect((await invite(a2.id)).statusCode).toBe(200);
    for (const companyId of [b.companyId, b2.id, missing()])
      expect((await invite(companyId)).statusCode).toBe(404);

    const own = await fixture.request("POST", "inviteStaff", a.cookie, {
      email: `${v7()}@example.test`,
      name: "Colleague",
    });
    const foreign = await fixture.request("POST", "inviteStaff", b.cookie, {
      email: `${v7()}@example.test`,
      name: "Colleague",
    });
    const resend = (inviteId: string) =>
      fixture.request("POST", "resendStaffInvite", a.cookie, { inviteId });
    expect((await resend(own.json().data.inviteId)).statusCode).toBe(200);
    for (const inviteId of [foreign.json().data.inviteId, missing()])
      expect((await resend(inviteId)).statusCode).toBe(404);
  });

  it("gives company users the table's capabilities and follows the stored import flag", async () => {
    const { a, superAdmin, member } = await setup();
    const view = async (cookie: string) =>
      (await context(a.company.slug, cookie)).json().data;
    expect((await view(superAdmin.cookie)).capabilities).toEqual(manager);
    expect((await view(superAdmin.cookie)).resourceAccess).toBe("all");
    expect((await view(member.cookie)).capabilities).toEqual(admin);
    expect((await view(member.cookie)).resourceAccess).toBe("own");

    await fixture.db.transaction((tx) =>
      withPlatformTenant(
        tx,
        { agencyId: a.agencyId, companyId: a.companyId, userId: a.user.id },
        (scoped) =>
          scoped
            .update(companies)
            .set({ settings: { super_admin_can_import: true } })
            .where(eq(companies.id, a.companyId)),
      ),
    );
    expect((await view(superAdmin.cookie)).capabilities).toEqual([
      ...manager,
      "imports.upload",
      "imports.commit",
    ]);
    expect((await view(member.cookie)).capabilities).toEqual(admin);
  });

  it("hides other companies from company users, in the same agency or another", async () => {
    const { a, b, a2, b2, superAdmin, member } = await setup();
    for (const cookie of [superAdmin.cookie, member.cookie]) {
      expect((await context(a.company.slug, cookie)).statusCode).toBe(200);
      for (const slug of [a2.slug, b.company.slug, b2.slug, `missing-${v7()}`])
        expect((await context(slug, cookie)).statusCode).toBe(404);
    }
  });

  it("refuses forged authority in cookies, headers and bodies", async () => {
    const { a, b, superAdmin } = await setup();
    const forged = {
      "x-agency-id": b.agencyId,
      "x-company-id": b.companyId,
      "x-role": "agency_staff",
    };
    expect(
      (await context(b.company.slug, superAdmin.cookie, forged)).statusCode,
    ).toBe(404);
    expect(
      (await context(a.company.slug, superAdmin.cookie, forged)).json().data
        .companyId,
    ).toBe(a.companyId);
    expect(
      (await context(a.company.slug, `anar_session=${"x".repeat(43)}`))
        .statusCode,
    ).toBe(401);
    const created = await fixture.companyRequest(
      "POST",
      "createCompany",
      a.cookie,
      {
        name: "Forged company",
        slug: `forged-${v7()}`,
        defaultCountry: "NP",
        timezone: "Asia/Kathmandu",
        agencyId: b.agencyId,
      },
    );
    expect(created.statusCode).toBe(400);
    const staff = await fixture.apps[0].app.inject({
      method: "POST",
      url: "/api/agencies/inviteStaff",
      payload: {
        email: `${v7()}@example.test`,
        name: "Colleague",
        agencyId: b.agencyId,
        role: "owner",
      },
      headers: { origin: publicOrigin, cookie: a.cookie, ...forged },
    });
    expect(staff.statusCode).toBe(400);
  });
});
