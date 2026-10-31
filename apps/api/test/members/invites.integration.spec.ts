import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import agencyService from "../../src/modules/agencies/service.js";
import inviteService from "../../src/modules/auth/invites.js";
import companyService from "../../src/modules/companies/service.js";
import { publicOrigin } from "../auth/fixture.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

describe("Super Admins invite and list Admins", () => {
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

  const request = (
    method: "GET" | "POST",
    slug: string,
    path: string,
    cookie: string,
    payload?: object,
  ) =>
    fixture.apps[0].app.inject({
      method,
      url: `/api/companies/${slug}/members/${path}`,
      payload,
      headers: { origin: publicOrigin, cookie },
    });
  const admin = () => ({ email: `${v7()}@example.test`, name: "New Admin" });
  async function companyUser(
    target: { agencyId: string; companyId: string },
    role: "super_admin" | "admin",
    ip: string,
  ) {
    const user = await fixture.seedUser();
    const member = await fixture.seedMember(target, user.id, "active", role);
    return { ...(await fixture.loginAs(user, { ip })), member };
  }
  async function setup() {
    const base = await fixture.setup();
    const manager = await companyUser(base.a, "super_admin", "198.51.100.71");
    const seller = await companyUser(base.a, "admin", "198.51.100.72");
    const foreign = await companyUser(base.b, "super_admin", "198.51.100.73");
    return { ...base, manager, seller, foreign, slug: base.a.company.slug };
  }
  const row = async (id: string) =>
    (
      await fixture.rows<{
        companyId: string;
        role: string;
        email: string;
        createdBy: string;
        acceptedAt: string | null;
        tokenHash: string;
        expiresAt: string;
      }>(
        sql`select company_id as "companyId", role, email, created_by as "createdBy",
          accepted_at as "acceptedAt", token_hash as "tokenHash", expires_at as "expiresAt"
          from invites where id = ${id}`,
      )
    )[0];
  async function current(id: string) {
    const stored = await row(id);
    const job = (await fixture.jobs()).find(
      (job) => job.key === `invite:${id}:${stored.tokenHash}`,
    );
    if (!job) throw new Error("Expected current invite job");
    const message = fixture.codec.decryptMessage(
      job.data.encryptedMessage,
      job.key,
    );
    const token = message.text.match(/\/invite#token=([A-Za-z0-9_-]{43})/)?.[1];
    if (!token) throw new Error("Expected current invite token");
    return { stored, job, message, token };
  }
  async function invited(cookie: string, slug: string) {
    const details = admin();
    const response = await request(
      "POST",
      slug,
      "inviteAdmin",
      cookie,
      details,
    );
    expect(response.statusCode).toBe(200);
    const inviteId: string = response.json().data.inviteId;
    return { details, inviteId, ...(await current(inviteId)) };
  }

  it("lists own company members with emails from the auth owner and pending invites apart", async () => {
    const { a, b, manager, seller, foreign, slug } = await setup();
    const own = await invited(manager.cookie, slug);
    await fixture.companyInvite(b);
    const members = await request("GET", slug, "listMembers", manager.cookie);
    expect(members.statusCode).toBe(200);
    expect(members.json().data).toEqual([
      expect.objectContaining({
        id: manager.member.id,
        role: "super_admin",
        status: "active",
        email: manager.user.email,
        name: manager.member.name,
        openLeads: 0,
        overdue: 0,
      }),
      expect.objectContaining({
        id: seller.member.id,
        role: "admin",
        email: seller.user.email,
      }),
    ]);
    expect(JSON.stringify(members.json())).not.toContain(foreign.user.email);
    const pending = await request("GET", slug, "listInvites", manager.cookie);
    expect(pending.json().data).toEqual([
      {
        id: own.inviteId,
        email: own.details.email,
        name: own.details.name,
        role: "admin",
        expiresAt: new Date(own.stored.expiresAt).toISOString(),
      },
    ]);
    expect(
      (await request("GET", b.company.slug, "listInvites", manager.cookie))
        .statusCode,
    ).toBe(404);
    for (const path of ["listMembers", "listInvites"]) {
      expect((await request("GET", slug, path, seller.cookie)).statusCode).toBe(
        403,
      );
      expect((await request("GET", slug, path, a.cookie)).statusCode).toBe(403);
    }
  });

  it("lets a Super Admin invite only an Admin, with one audit and email", async () => {
    const { manager, slug } = await setup();
    const issued = await invited(manager.cookie, slug);
    expect(issued.stored).toMatchObject({
      companyId: manager.member.companyId,
      role: "admin",
      email: issued.details.email,
      createdBy: manager.user.id,
      acceptedAt: null,
    });
    expect(issued.message.to).toBe(issued.details.email);
    expect(
      await fixture.db.transaction((tx) =>
        inviteService.findDeliverable(
          tx,
          issued.inviteId,
          fixture.now(),
          agencyService.readInitialInviteAgency,
          agencyService.readStaffInviteAgency,
          companyService.readCompanyInviteTarget,
        ),
      ),
    ).toMatchObject({ key: issued.job.key });
    expect(
      await fixture.rows(
        sql`select actor_user_id, actor_role, company_id, target_id from audit_log where action = 'company.admin_invited'`,
      ),
    ).toEqual([
      {
        actor_user_id: manager.user.id,
        actor_role: "super_admin",
        company_id: manager.member.companyId,
        target_id: issued.inviteId,
      },
    ]);
    for (const forged of [
      { ...admin(), role: "super_admin" },
      { ...admin(), companyId: v7() },
    ])
      expect(
        (await request("POST", slug, "inviteAdmin", manager.cookie, forged))
          .statusCode,
      ).toBe(400);
  });

  it("refuses the invite to Admins, agency staff and the owner", async () => {
    const { owner, a, seller, slug } = await setup();
    for (const cookie of [seller.cookie, a.cookie, owner.cookie]) {
      const response = await request(
        "POST",
        slug,
        "inviteAdmin",
        cookie,
        admin(),
      );
      expect(response.statusCode).toBe(403);
    }
    expect(
      await fixture.rows(
        sql`select count(*)::int as count from invites where role = 'admin'`,
      ),
    ).toEqual([{ count: 0 }]);
  });

  it("asks for a fresh code before inviting or resending", async () => {
    const { manager, slug } = await setup();
    const issued = await invited(manager.cookie, slug);
    fixture.advance(15 * 60000 + 1000);
    const created = await request(
      "POST",
      slug,
      "inviteAdmin",
      manager.cookie,
      admin(),
    );
    const resent = await request("POST", slug, "resendInvite", manager.cookie, {
      inviteId: issued.inviteId,
    });
    for (const response of [created, resent]) {
      expect(response.statusCode).toBe(428);
      expect(response.json().error).toBe("step_up_required");
    }
    expect((await row(issued.inviteId)).tokenHash).toBe(
      issued.stored.tokenHash,
    );
    expect(
      await fixture.rows(
        sql`select count(*)::int as count from invites where role = 'admin'`,
      ),
    ).toEqual([{ count: 1 }]);
  });

  it("stops the old link after a resend and the new one works", async () => {
    const { manager, slug } = await setup();
    const issued = await invited(manager.cookie, slug);
    fixture.advance(1000);
    const response = await request(
      "POST",
      slug,
      "resendInvite",
      manager.cookie,
      { inviteId: issued.inviteId },
    );
    expect(response.statusCode).toBe(200);
    const next = await current(issued.inviteId);
    expect(next.token).not.toBe(issued.token);
    expect(
      (await fixture.post("inspectInvite", { token: issued.token })).statusCode,
    ).toBe(404);
    const accepted = await fixture.post(
      "acceptInvite",
      { token: next.token, name: "New Admin" },
      { ip: "198.51.100.74" },
    );
    expect(accepted.statusCode).toBe(200);
    const listed = await request("GET", slug, "listMembers", manager.cookie);
    expect(listed.json().data).toContainEqual(
      expect.objectContaining({
        userId: accepted.json().data.userId,
        role: "admin",
        email: issued.details.email,
      }),
    );
    expect(
      (await request("GET", slug, "listInvites", manager.cookie)).json().data,
    ).toEqual([]);
  });

  it("hides Super Admin, foreign and missing invites from resend", async () => {
    const { a, b, manager, foreign, slug } = await setup();
    const superAdmin = await fixture.companyInvite(a);
    const other = await invited(foreign.cookie, b.company.slug);
    for (const inviteId of [superAdmin.inviteId, other.inviteId, v7()]) {
      const response = await request(
        "POST",
        slug,
        "resendInvite",
        manager.cookie,
        { inviteId },
      );
      expect(response.statusCode).toBe(404);
      expect(JSON.stringify(response.json())).not.toContain(b.companyId);
    }
    expect((await row(other.inviteId)).tokenHash).toBe(other.stored.tokenHash);
  });

  it("lets entered agency staff resend a Super Admin invite", async () => {
    const { a, slug } = await setup();
    const superAdmin = await fixture.companyInvite(a);
    const entered = await fixture.companyRequest(
      "POST",
      "enterCompany",
      a.cookie,
      { companyId: a.companyId, reason: "Helping the client team" },
    );
    expect(entered.statusCode).toBe(200);
    fixture.advance(1000);
    const response = await request("POST", slug, "resendInvite", a.cookie, {
      inviteId: superAdmin.inviteId,
    });
    expect(response.statusCode).toBe(200);
    const next = await current(superAdmin.inviteId);
    expect(next.token).not.toBe(superAdmin.token);
    expect(
      (await fixture.post("inspectInvite", { token: superAdmin.token }))
        .statusCode,
    ).toBe(404);
  });
});
