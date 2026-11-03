import {
  companyMembers,
  createTenantDb,
  leads,
  stages,
  type TenantDb,
} from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { publicOrigin } from "../auth/fixture.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

describe("Super Admins remove Admins and their access ends at once", () => {
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
    target: { agencyId: string; companyId: string },
    fn: Parameters<TenantDb["withTenant"]>[1],
  ) => tenantDb.withTenant({ ...target, userId: v7() }, fn) as Promise<T>;

  const remove = (slug: string, cookie: string, payload: object, index = 0) =>
    fixture.apps[index].app.inject({
      method: "POST",
      url: `/api/companies/${slug}/members/deactivateMember`,
      payload,
      headers: { origin: publicOrigin, cookie },
    });
  const session = (cookie: string) =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: "/api/auth/getSession",
      headers: { cookie },
    });
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
    const manager = await companyUser(base.a, "super_admin", "198.51.100.61");
    const second = await companyUser(base.a, "super_admin", "198.51.100.62");
    const seller = await companyUser(base.a, "admin", "198.51.100.63");
    const foreign = await companyUser(base.b, "admin", "198.51.100.64");
    const foreignManager = await companyUser(
      base.b,
      "super_admin",
      "198.51.100.66",
    );
    viewers = [
      { slug: base.a.company.slug, cookie: manager.cookie },
      { slug: base.b.company.slug, cookie: foreignManager.cookie },
    ];
    return {
      ...base,
      manager,
      second,
      seller,
      foreign,
      slug: base.a.company.slug,
    };
  }
  let viewers: { slug: string; cookie: string }[] = [];
  async function status(memberId: string) {
    for (const { slug, cookie } of viewers) {
      const response = await fixture.apps[0].app.inject({
        method: "GET",
        url: `/api/companies/${slug}/members/listMembers`,
        headers: { cookie },
      });
      const member = (
        response.json().data as { id: string; status: string }[]
      ).find((row) => row.id === memberId);
      if (member) return member.status;
    }
    throw new Error("Expected the member in one of the companies");
  }
  const audits = () =>
    fixture.rows<{ target_id: string; actor_role: string }>(
      sql`select target_id, actor_role from audit_log where action = 'company.member_deactivated'`,
    );

  it("removes an Admin and refuses the Admin's next request", async () => {
    const { manager, seller, slug } = await setup();
    expect((await session(seller.cookie)).statusCode).toBe(200);
    const response = await remove(slug, manager.cookie, {
      memberId: seller.member.id,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: { reassigned: 0 } });
    expect(await status(seller.member.id)).toBe("deactivated");
    expect((await session(seller.cookie)).statusCode).toBe(401);
    expect((await session(manager.cookie)).statusCode).toBe(200);
    expect(await audits()).toEqual([
      { target_id: seller.member.id, actor_role: "super_admin" },
    ]);
  });

  it("hides another company's member and a missing member", async () => {
    const { manager, foreign, slug } = await setup();
    for (const memberId of [foreign.member.id, v7()]) {
      const response = await remove(slug, manager.cookie, { memberId });
      expect(response.statusCode).toBe(404);
    }
    expect(await status(foreign.member.id)).toBe("active");
    expect((await session(foreign.cookie)).statusCode).toBe(200);
  });

  it("does not let a Super Admin remove a Super Admin, themselves included", async () => {
    const { manager, second, slug } = await setup();
    for (const memberId of [second.member.id, manager.member.id]) {
      const response = await remove(slug, manager.cookie, { memberId });
      expect(response.statusCode).toBe(403);
    }
    expect(await status(second.member.id)).toBe("active");
    expect(await status(manager.member.id)).toBe("active");
    expect(await audits()).toEqual([]);
  });

  it("keeps a repeat or concurrent removal harmless with one audit", async () => {
    const { manager, second, seller, slug } = await setup();
    const responses = await Promise.all([
      remove(slug, manager.cookie, { memberId: seller.member.id }, 0),
      remove(slug, second.cookie, { memberId: seller.member.id }, 1),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200,
    ]);
    const again = await remove(slug, manager.cookie, {
      memberId: seller.member.id,
    });
    expect(again.statusCode).toBe(200);
    expect(await status(seller.member.id)).toBe("deactivated");
    expect(await audits()).toHaveLength(1);
  });

  it("refuses reassignment to the member being removed", async () => {
    const { manager, seller, slug } = await setup();
    const response = await remove(slug, manager.cookie, {
      memberId: seller.member.id,
      reassignTo: seller.member.id,
    });
    expect(response.statusCode).toBe(400);
    expect(await status(seller.member.id)).toBe("active");
  });

  it("refuses an inactive or foreign destination", async () => {
    const { a, manager, seller, foreign, slug } = await setup();
    const inactive = await companyUser(a, "admin", "198.51.100.67");
    await scoped(a, (tx) =>
      tx
        .update(companyMembers)
        .set({ status: "deactivated", deactivatedAt: fixture.now() })
        .where(eq(companyMembers.id, inactive.member.id)),
    );
    for (const reassignTo of [inactive.member.id, foreign.member.id]) {
      const response = await remove(slug, manager.cookie, {
        memberId: seller.member.id,
        reassignTo,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(await status(seller.member.id)).toBe("active");
  });

  it("requires a fresh code and refuses Admins, agency staff and the owner", async () => {
    const { owner, a, manager, seller, slug } = await setup();
    const other = await companyUser(a, "admin", "198.51.100.65");
    for (const cookie of [seller.cookie, a.cookie, owner.cookie]) {
      const response = await remove(slug, cookie, {
        memberId: other.member.id,
      });
      expect(response.statusCode).toBe(403);
    }
    fixture.advance(15 * 60000 + 1000);
    const stale = await remove(slug, manager.cookie, {
      memberId: other.member.id,
    });
    expect(stale.statusCode).toBe(428);
    expect(stale.json().error).toBe("step_up_required");
    expect(await status(other.member.id)).toBe("active");
  });

  it.each(["revocation", "audit"])(
    "rolls back the membership, revocation and audit when the %s fails",
    async (failing) => {
      const { a, manager, seller, slug } = await setup();
      const leadId = v7();
      await scoped(a, async (tx) => {
        const [stage] = await tx
          .select({ id: stages.id })
          .from(stages)
          .where(eq(stages.isDefault, true));
        await tx.insert(leads).values({
          id: leadId,
          companyId: a.companyId,
          phoneValid: false,
          sourceKind: "manual",
          leadDate: fixture.now(),
          stageId: stage.id,
          custom: {},
          score: 0,
          priority: "cold",
          scoreBreakdown: {},
          scoredAt: fixture.now(),
          assignedTo: seller.member.id,
        });
      });
      const [break_, restore] =
        failing === "revocation"
          ? [
              `CREATE FUNCTION fail_member_revoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Proof revoke failure'; END $$;
               CREATE TRIGGER fail_member_revoke BEFORE UPDATE OF revoked_at ON sessions FOR EACH ROW EXECUTE FUNCTION fail_member_revoke()`,
              "DROP TRIGGER fail_member_revoke ON sessions; DROP FUNCTION fail_member_revoke()",
            ]
          : [
              "REVOKE INSERT ON public.audit_log FROM anar_app",
              "GRANT INSERT ON public.audit_log TO anar_app",
            ];
      await fixture.owner(break_);
      try {
        const response = await remove(slug, manager.cookie, {
          memberId: seller.member.id,
        });
        expect(response.statusCode).toBe(500);
      } finally {
        await fixture.owner(restore);
      }
      expect(await status(seller.member.id)).toBe("active");
      expect((await session(seller.cookie)).statusCode).toBe(200);
      expect(await audits()).toEqual([]);
      expect(
        await scoped(a, (tx) =>
          tx
            .select({ assignedTo: leads.assignedTo })
            .from(leads)
            .where(eq(leads.id, leadId)),
        ),
      ).toEqual([{ assignedTo: seller.member.id }]);
      expect(
        await scoped(
          a,
          async (tx) =>
            (
              await tx.execute(
                sql`select id from lead_events where lead_id = ${leadId}::uuid`,
              )
            ).rows,
        ),
      ).toEqual([]);
    },
  );

  it("revokes the removed member's sessions in other companies", async () => {
    const { b, manager, seller, slug } = await setup();
    await fixture.seedMember(b, seller.user.id, "active", "admin");
    const response = await remove(slug, manager.cookie, {
      memberId: seller.member.id,
    });
    expect(response.statusCode).toBe(200);
    expect((await session(seller.cookie)).statusCode).toBe(401);
    const otherCompany = await fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${b.company.slug}/members/listMembers`,
      headers: { cookie: seller.cookie },
    });
    expect(otherCompany.statusCode).toBe(401);
  });

  const enterAs = async (cookie: string, companyId: string) => {
    const response = await fixture.companyRequest(
      "POST",
      "enterCompany",
      cookie,
      { companyId, reason: "Helping the client team" },
    );
    expect(response.statusCode).toBe(200);
  };

  it("keeps the last Super Admin who can still sign in", async () => {
    const { a, manager, second, slug } = await setup();
    await fixture.owner(
      `UPDATE users SET deactivated_at = now() WHERE id = '${second.user.id}'`,
    );
    await enterAs(a.cookie, a.companyId);
    const response = await remove(slug, a.cookie, {
      memberId: manager.member.id,
    });
    expect(response.statusCode).toBe(409);
    expect(await status(manager.member.id)).toBe("active");
  });

  it("keeps one Super Admin when two removals race", async () => {
    const { a, manager, second, slug } = await setup();
    await enterAs(a.cookie, a.companyId);
    const responses = await Promise.all([
      remove(slug, a.cookie, { memberId: manager.member.id }, 0),
      remove(slug, a.cookie, { memberId: second.member.id }, 1),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    const states = await scoped<{ status: string }[]>(
      a,
      async (tx) =>
        (
          await tx.execute<{ status: string }>(
            sql`select status from company_members where id in (${manager.member.id}::uuid, ${second.member.id}::uuid) order by status`,
          )
        ).rows,
    );
    expect(states.map((row) => row.status)).toEqual(["active", "deactivated"]);
  });

  it("revokes the pending invites of a removed Super Admin", async () => {
    const { a, manager, second, slug } = await setup();
    const email = `${v7()}@example.test`;
    const invited = await fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${slug}/members/inviteAdmin`,
      payload: { email, name: "Pending Admin" },
      headers: { origin: publicOrigin, cookie: manager.cookie },
    });
    expect(invited.statusCode).toBe(200);
    await enterAs(a.cookie, a.companyId);
    expect(
      (await remove(slug, a.cookie, { memberId: manager.member.id }))
        .statusCode,
    ).toBe(200);
    const resent = await fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${slug}/members/resendInvite`,
      payload: { inviteId: invited.json().data.inviteId },
      headers: { origin: publicOrigin, cookie: a.cookie },
    });
    expect(resent.statusCode).toBe(404);
    const again = await fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${slug}/members/inviteAdmin`,
      payload: { email, name: "Pending Admin" },
      headers: { origin: publicOrigin, cookie: second.cookie },
    });
    expect(again.statusCode).toBe(200);
  });
});
