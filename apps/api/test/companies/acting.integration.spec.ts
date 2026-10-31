import {
  agencies,
  companies,
  users,
  withPlatformAgency,
  withPlatformTenant,
} from "@anar/db/platform";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { publicOrigin } from "../auth/fixture.js";
import { type CompanyFixture, startCompanyFixture } from "./fixture.js";

const hour = 3600000;

describe("agency staff enter and leave their own companies", () => {
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

  const reason = "Checking the import for the client";
  const enter = (cookie: string, companyId: string, why = reason) =>
    fixture.companyRequest("POST", "enterCompany", cookie, {
      companyId,
      reason: why,
    });
  const leave = (cookie: string) =>
    fixture.companyRequest("POST", "leaveCompany", cookie, {});
  const context = (slug: string, cookie: string) =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/context?company=${slug}`,
      headers: { cookie },
    });
  const acting = async (userId: string) =>
    (await fixture.sessionRows(userId)).map((row) => ({
      companyId: row.actingCompanyId,
      reason: row.actingReason,
      until: row.actingUntil,
    }));
  const audits = (action: string) =>
    fixture.rows<{ actor_user_id: string; company_id: string; data: object }>(
      sql`select actor_user_id, company_id, data from audit_log where action = ${action} order by id`,
    );
  async function setup() {
    const base = await fixture.setup();
    const a2 = await fixture.createCompany(base.a.cookie);
    return { ...base, a2 };
  }
  async function companyUser(
    target: { agencyId: string; companyId: string },
    role: "super_admin" | "admin",
  ) {
    const user = await fixture.seedUser();
    const member = await fixture.seedMember(target, user.id, "active", role);
    return {
      ...(await fixture.loginAs(user, { ip: "198.51.100.40" })),
      member,
    };
  }

  it("enters for eight hours as agency staff with one audit", async () => {
    const { a } = await setup();
    const response = await enter(a.cookie, a.companyId);
    expect(response.statusCode).toBe(200);
    expect(await acting(a.user.id)).toEqual([
      {
        companyId: a.companyId,
        reason,
        until: new Date(fixture.now().getTime() + 8 * hour),
      },
    ]);
    const view = await context(a.company.slug, a.cookie);
    expect(view.statusCode).toBe(200);
    expect(view.json().data).toMatchObject({
      companyId: a.companyId,
      role: "agency_staff",
      member: null,
      session: { actingCompanyId: a.companyId, actingReason: reason },
    });
    expect(await audits("agency.enter_company")).toEqual([
      {
        actor_user_id: a.user.id,
        company_id: a.companyId,
        data: { companyId: a.companyId, reason },
      },
    ]);
  });

  it("refuses the owner and company users", async () => {
    const { owner, a } = await setup();
    const manager = await companyUser(a, "super_admin");
    for (const cookie of [owner.cookie, manager.cookie])
      expect((await enter(cookie, a.companyId)).statusCode).toBe(403);
    expect(await audits("agency.enter_company")).toEqual([]);
  });

  it.each([
    ["a missing reason", { companyId: "" }],
    ["a short reason", { reason: "abcd" }],
    ["a blank reason", { reason: "      " }],
  ])("refuses %s", async (_name, override) => {
    const { a } = await setup();
    const response = await fixture.companyRequest(
      "POST",
      "enterCompany",
      a.cookie,
      "reason" in override
        ? { companyId: a.companyId, reason: override.reason }
        : { companyId: a.companyId },
    );
    expect(response.statusCode).toBe(400);
    expect(await acting(a.user.id)).toEqual([
      { companyId: null, reason: null, until: null },
    ]);
  });

  it("rolls back the entry when the audit fails", async () => {
    const { a } = await setup();
    await fixture.owner("REVOKE INSERT ON public.audit_log FROM anar_app");
    try {
      expect((await enter(a.cookie, a.companyId)).statusCode).toBe(500);
    } finally {
      await fixture.owner("GRANT INSERT ON public.audit_log TO anar_app");
    }
    expect(await acting(a.user.id)).toEqual([
      { companyId: null, reason: null, until: null },
    ]);
  });

  it("hides another agency's company by ID and by slug", async () => {
    const { a, b } = await setup();
    expect((await enter(a.cookie, b.companyId)).statusCode).toBe(404);
    expect((await enter(a.cookie, v7())).statusCode).toBe(404);
    await enter(a.cookie, a.companyId);
    expect((await context(b.company.slug, a.cookie)).statusCode).toBe(404);
  });

  it("keeps the entry on the same company when its slug changes", async () => {
    const { a, a2 } = await setup();
    await enter(a.cookie, a.companyId);
    const renamed = `renamed-${v7()}`;
    await fixture.db.transaction((tx) =>
      withPlatformTenant(
        tx,
        { agencyId: a.agencyId, companyId: a.companyId, userId: a.user.id },
        (scoped) =>
          scoped
            .update(companies)
            .set({ slug: renamed })
            .where(eq(companies.id, a.companyId)),
      ),
    );
    expect((await context(a.company.slug, a.cookie)).statusCode).toBe(404);
    expect((await context(renamed, a.cookie)).json().data.companyId).toBe(
      a.companyId,
    );
    expect((await context(a2.slug, a.cookie)).statusCode).toBe(403);
  });

  it("ends the entry at eight hours, and refresh or a fresh code do not extend it", async () => {
    const { a } = await setup();
    await enter(a.cookie, a.companyId);
    fixture.advance(7 * hour);
    expect(
      (await fixture.post("refresh", {}, { cookie: a.cookie })).statusCode,
    ).toBe(200);
    await fixture.post("requestStepUp", {}, { cookie: a.cookie });
    const { code } = await fixture.currentCode(a.user.id);
    expect(
      (await fixture.post("stepUp", { code }, { cookie: a.cookie })).statusCode,
    ).toBe(200);
    fixture.advance(hour - 1000);
    expect((await context(a.company.slug, a.cookie)).statusCode).toBe(200);
    fixture.advance(1000);
    expect((await context(a.company.slug, a.cookie)).statusCode).toBe(403);
  });

  it("moves the entry to the second company and closes the first", async () => {
    const { a, a2 } = await setup();
    await enter(a.cookie, a.companyId);
    expect((await context(a.company.slug, a.cookie)).statusCode).toBe(200);
    await enter(a.cookie, a2.id);
    expect((await context(a.company.slug, a.cookie)).statusCode).toBe(403);
    expect((await context(a2.slug, a.cookie)).statusCode).toBe(200);
  });

  it("leaves only this session's entry, even after it expired", async () => {
    const { a } = await setup();
    const [user] = await fixture.db.transaction((tx) =>
      tx.select().from(users).where(eq(users.id, a.user.id)),
    );
    const other = await fixture.loginAs(user, { ip: "198.51.100.41" });
    await enter(a.cookie, a.companyId);
    await enter(other.cookie, a.companyId);
    fixture.advance(9 * hour);
    expect((await leave(a.cookie)).statusCode).toBe(200);
    const rows = await acting(a.user.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.companyId === null)).toHaveLength(1);
    expect(rows.filter((row) => row.companyId === a.companyId)).toHaveLength(1);
    expect(await audits("agency.leave_company")).toHaveLength(1);
  });

  it.each(["company", "agency"])(
    "leaves after the %s is suspended",
    async (kind) => {
      const { a } = await setup();
      await enter(a.cookie, a.companyId);
      await fixture.db.transaction((tx) =>
        kind === "company"
          ? withPlatformAgency(
              tx,
              { agencyId: a.agencyId, userId: a.user.id },
              (scoped) =>
                scoped
                  .update(companies)
                  .set({ status: "suspended" })
                  .where(eq(companies.id, a.companyId)),
            )
          : tx
              .update(agencies)
              .set({ status: "suspended" })
              .where(eq(agencies.id, a.agencyId)),
      );
      expect((await context(a.company.slug, a.cookie)).statusCode).not.toBe(
        200,
      );
      expect((await leave(a.cookie)).statusCode).toBe(200);
      expect(await acting(a.user.id)).toEqual([
        { companyId: null, reason: null, until: null },
      ]);
    },
  );

  it("writes no audit for a leave without an entry", async () => {
    const { a } = await setup();
    expect((await leave(a.cookie)).statusCode).toBe(200);
    expect((await leave(a.cookie)).statusCode).toBe(200);
    expect(await audits("agency.leave_company")).toEqual([]);
  });

  it("makes an old entry unusable once the staff member is removed", async () => {
    const { a } = await setup();
    const email = `${v7()}@example.test`;
    const invited = await fixture.request("POST", "inviteStaff", a.cookie, {
      email,
      name: "Colleague",
    });
    const job = (await fixture.jobs()).find(
      (row) => row.data.referenceId === invited.json().data.inviteId,
    );
    if (!job) throw new Error("Expected staff invite email");
    const token = fixture.codec
      .decryptMessage(job.data.encryptedMessage, job.key)
      .text.match(/\/invite#token=([A-Za-z0-9_-]{43})/)?.[1];
    const accepted = await fixture.post(
      "acceptInvite",
      { token, name: "Colleague" },
      { ip: "198.51.100.42" },
    );
    const [user] = await fixture.db.transaction((tx) =>
      tx.select().from(users).where(eq(users.id, accepted.json().data.userId)),
    );
    const colleague = await fixture.loginAs(user, { ip: "198.51.100.42" });
    await enter(colleague.cookie, a.companyId);
    expect((await context(a.company.slug, colleague.cookie)).statusCode).toBe(
      200,
    );
    const staffId = (
      await fixture.request("GET", "getAgency", colleague.cookie)
    ).json().data.staff.id;
    expect(
      (
        await fixture.request("POST", "deactivateStaff", a.cookie, {
          staffId,
        })
      ).statusCode,
    ).toBe(200);
    expect((await context(a.company.slug, colleague.cookie)).statusCode).toBe(
      401,
    );
  });

  it("lets entered staff remove a Super Admin but never the last one, even at once", async () => {
    const { a } = await setup();
    const first = await companyUser(a, "super_admin");
    const second = await companyUser(a, "super_admin");
    const [user] = await fixture.db.transaction((tx) =>
      tx.select().from(users).where(eq(users.id, a.user.id)),
    );
    const other = await fixture.loginAs(user, { ip: "198.51.100.43" });
    await enter(a.cookie, a.companyId);
    await enter(other.cookie, a.companyId);
    const remove = (cookie: string, memberId: string, index: number) =>
      fixture.apps[index].app.inject({
        method: "POST",
        url: `/api/companies/${a.company.slug}/members/deactivateMember`,
        payload: { memberId },
        headers: { origin: publicOrigin, cookie },
      });
    const results = await Promise.all([
      remove(a.cookie, first.member.id, 0),
      remove(other.cookie, second.member.id, 1),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    const active = await fixture.db.transaction((tx) =>
      withPlatformTenant(
        tx,
        { agencyId: a.agencyId, companyId: a.companyId, userId: a.user.id },
        async (scoped) =>
          (
            await scoped.execute(
              sql`select count(*)::int as count from company_members where role = 'super_admin' and status = 'active'`,
            )
          ).rows,
      ),
    );
    expect(active).toEqual([{ count: 1 }]);
  });
});
