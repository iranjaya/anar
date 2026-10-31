import {
  agencies,
  agencyMembers,
  invites,
  users,
  withPlatformAgency,
} from "@anar/db/platform";
import { and, eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import agencyService from "../../src/modules/agencies/service.js";
import inviteService from "../../src/modules/auth/invites.js";
import companyService from "../../src/modules/companies/service.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

describe("agency staff invite their own colleagues", () => {
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

  type Staff = Awaited<ReturnType<CompanyFixture["setup"]>>["a"];
  const colleague = () => ({
    email: `${v7()}@example.test`,
    name: "New colleague",
  });
  const invite = (actor: { cookie: string }, payload: object = colleague()) =>
    fixture.request("POST", "inviteStaff", actor.cookie, payload);
  const resend = (actor: Staff, inviteId: string) =>
    fixture.request("POST", "resendStaffInvite", actor.cookie, { inviteId });
  const row = (id: string) =>
    fixture.db.transaction(
      async (tx) =>
        (await tx.select().from(invites).where(eq(invites.id, id)))[0],
    );
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
  async function invited(actor: Staff) {
    const details = colleague();
    const response = await invite(actor, details);
    expect(response.statusCode).toBe(200);
    const inviteId: string = response.json().data.inviteId;
    return { details, inviteId, ...(await current(inviteId)) };
  }
  const audits = (action: string) =>
    fixture.rows(
      sql`select actor_user_id,actor_role,agency_id,company_id,target_type,target_id,data from audit_log where action=${action} order by id`,
    );
  const deliverable = (id: string) =>
    fixture.db.transaction((tx) =>
      inviteService.findDeliverable(
        tx,
        id,
        fixture.now(),
        agencyService.readInitialInviteAgency,
        agencyService.readStaffInviteAgency,
        companyService.readCompanyInviteTarget,
      ),
    );

  it("sends a staff invite for the own agency and records one audit", async () => {
    const { a } = await fixture.setup();
    const issued = await invited(a);
    expect(issued.stored).toMatchObject({
      agencyId: a.agencyId,
      companyId: null,
      role: "agency_staff",
      email: issued.details.email,
      name: issued.details.name,
      createdBy: a.user.id,
      acceptedAt: null,
      revokedAt: null,
    });
    expect(issued.message.to).toBe(issued.details.email);
    expect(issued.message.subject).toContain("team on Anar");
    expect(await deliverable(issued.inviteId)).toMatchObject({
      email: issued.details.email,
      key: issued.job.key,
    });
    expect(await audits("agency.staff_invited")).toEqual([
      {
        actor_user_id: a.user.id,
        actor_role: "agency_staff",
        agency_id: a.agencyId,
        company_id: null,
        target_type: "invite",
        target_id: issued.inviteId,
        data: { inviteId: issued.inviteId },
      },
    ]);
    const listed = await fixture.request("GET", "listInvites", a.cookie);
    expect(
      listed.json().data.items.map((item: { id: string }) => item.id),
    ).toContain(issued.inviteId);
  });

  it("refuses to invite or resend when the code is older than 15 minutes", async () => {
    const { a } = await fixture.setup();
    const issued = await invited(a);
    const before = await fixture.rows(
      sql`select count(*)::int as invites from invites`,
    );
    fixture.advance(15 * 60000 + 1000);
    const created = await invite(a);
    const resent = await resend(a, issued.inviteId);
    for (const response of [created, resent]) {
      expect(response.statusCode).toBe(428);
      expect(response.json().error).toBe("step_up_required");
    }
    expect(
      await fixture.rows(sql`select count(*)::int as invites from invites`),
    ).toEqual(before);
    expect((await row(issued.inviteId)).tokenHash).toBe(
      issued.stored.tokenHash,
    );
  });

  it("keeps each agency to its own invites and ignores forged agency or role", async () => {
    const { owner, a, b } = await fixture.setup();
    const issued = await invited(a);
    const foreign = await resend(b, issued.inviteId);
    expect(foreign.statusCode).toBe(404);
    expect(JSON.stringify(foreign.json())).not.toContain(a.agencyId);
    expect((await row(issued.inviteId)).tokenHash).toBe(
      issued.stored.tokenHash,
    );
    for (const forged of [
      { ...colleague(), agencyId: b.agencyId },
      { ...colleague(), role: "super_admin" },
    ]) {
      const response = await invite(a, forged);
      expect(response.statusCode).toBe(400);
    }
    expect((await invite(owner, colleague())).statusCode).toBe(403);
  });

  it("refuses to resend an invite that is not a staff invite", async () => {
    const { a } = await fixture.setup();
    const company = await fixture.companyInvite(a);
    const response = await resend(a, company.inviteId);
    expect(response.statusCode).toBe(404);
    expect((await row(company.inviteId)).tokenHash).toBe(
      (await current(company.inviteId)).stored.tokenHash,
    );
    expect(await audits("agency.staff_invite_resent")).toEqual([]);
  });

  it("stops the old link after a resend and the new link works", async () => {
    const { a } = await fixture.setup();
    const issued = await invited(a);
    fixture.advance(1000);
    const response = await resend(a, issued.inviteId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: { ok: true } });
    const next = await current(issued.inviteId);
    expect(next.token).not.toBe(issued.token);
    expect(next.stored.expiresAt).toEqual(
      new Date(fixture.now().getTime() + 7 * 86400000),
    );
    expect(
      (await fixture.post("inspectInvite", { token: issued.token })).statusCode,
    ).toBe(404);
    const inspected = await fixture.post("inspectInvite", {
      token: next.token,
    });
    expect(inspected.statusCode).toBe(200);
    expect(inspected.json().data).toMatchObject({
      kind: "agency_staff",
      email: issued.details.email,
      companyName: null,
    });
    expect(await audits("agency.staff_invite_resent")).toHaveLength(1);
  });

  it("lets the invited colleague join the already active agency", async () => {
    const { a } = await fixture.setup();
    const issued = await invited(a);
    const accepted = await fixture.post(
      "acceptInvite",
      { token: issued.token, name: "New colleague" },
      { ip: "198.51.100.91" },
    );
    expect(accepted.statusCode).toBe(200);
    const userId: string = accepted.json().data.userId;
    const staff = await fixture.db.transaction((tx) =>
      withPlatformAgency(tx, { agencyId: a.agencyId, userId }, (scoped) =>
        scoped
          .select({
            userId: agencyMembers.userId,
            status: agencyMembers.status,
            invitedBy: agencyMembers.invitedBy,
          })
          .from(agencyMembers)
          .where(eq(agencyMembers.agencyId, a.agencyId)),
      ),
    );
    expect(staff).toEqual(
      expect.arrayContaining([
        { userId: a.user.id, status: "active", invitedBy: expect.any(String) },
        { userId, status: "active", invitedBy: a.user.id },
      ]),
    );
    const [agency] = await fixture.db.transaction((tx) =>
      tx.select().from(agencies).where(eq(agencies.id, a.agencyId)),
    );
    expect(agency.status).toBe("active");
    const [user] = await fixture.db.transaction((tx) =>
      tx.select().from(users).where(eq(users.id, userId)),
    );
    const login = await fixture.loginAs(user, { ip: "198.51.100.91" });
    const view = await fixture.request("GET", "getAgency", login.cookie);
    expect(view.statusCode).toBe(200);
    expect(view.json().data.agency.id).toBe(a.agencyId);
    expect(await audits("agency.staff_accepted")).toContainEqual(
      expect.objectContaining({
        actor_user_id: userId,
        agency_id: a.agencyId,
        data: { inviteId: issued.inviteId, inviterId: a.user.id },
      }),
    );
  });

  it("stops a pending invite once its issuer is no longer active staff", async () => {
    const { a } = await fixture.setup();
    const issued = await invited(a);
    await fixture.db.transaction((tx) =>
      withPlatformAgency(
        tx,
        { agencyId: a.agencyId, userId: a.user.id },
        (scoped) =>
          scoped
            .update(agencyMembers)
            .set({ status: "deactivated", deactivatedAt: fixture.now() })
            .where(
              and(
                eq(agencyMembers.agencyId, a.agencyId),
                eq(agencyMembers.userId, a.user.id),
              ),
            ),
      ),
    );
    expect(
      (await fixture.post("inspectInvite", { token: issued.token })).statusCode,
    ).toBe(404);
    expect(
      (
        await fixture.post("acceptInvite", {
          token: issued.token,
          name: "New colleague",
        })
      ).statusCode,
    ).toBe(404);
    expect(await deliverable(issued.inviteId)).toBeUndefined();
  });

  it("replaces an expired pending invite when the same email is invited again", async () => {
    const { a } = await fixture.setup();
    const issued = await invited(a);
    fixture.advance(7 * 86400000 + 1000);
    await fixture.post("requestStepUp", {}, { cookie: a.cookie });
    const { code } = await fixture.currentCode(a.user.id);
    await fixture.post("stepUp", { code }, { cookie: a.cookie });
    const again = await invite(a, issued.details);
    expect(again.statusCode).toBe(200);
    expect((await row(issued.inviteId)).revokedAt).not.toBeNull();
    const pending = await fixture.request("GET", "listInvites", a.cookie);
    expect(
      pending
        .json()
        .data.items.filter(
          (item: { email: string }) => item.email === issued.details.email,
        )
        .map((item: { id: string }) => item.id),
    ).toEqual([again.json().data.inviteId]);
  });

  it("still refuses a second invite while the first is pending", async () => {
    const { a } = await fixture.setup();
    const issued = await invited(a);
    expect((await invite(a, issued.details)).statusCode).toBe(409);
  });
});
