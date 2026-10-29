import {
  agencies,
  agencyMembers,
  companies,
  invites,
  users,
  withPlatformAgency,
  withPlatformTenant,
} from "@anar/db/platform";
import { companyMembers } from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

describe("company invitation acceptance", () => {
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
  const accept = (token: string, index = 0) =>
    fixture.post(
      "acceptInvite",
      { token, name: "Accepted manager" },
      { ip: "198.51.100.90", index },
    );
  const stored = (inviteId: string) =>
    fixture.db.transaction((tx) =>
      tx.select().from(invites).where(eq(invites.id, inviteId)),
    );

  it("previews without consumption then activates the exact company membership without a cookie", async () => {
    const { a } = await fixture.setup();
    const issued = await fixture.companyInvite(a);
    const before = await stored(issued.inviteId);
    const preview = await fixture.post("inspectInvite", {
      token: issued.token,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data).toEqual({
      kind: "company_member",
      email: issued.input.email,
      name: issued.input.name,
      agencyName: a.details.name,
      companyName: a.company.name,
      expiresAt: before[0].expiresAt.toISOString(),
    });
    expect(await stored(issued.inviteId)).toEqual(before);
    expect(preview.headers["set-cookie"]).toBeUndefined();
    const response = await accept(issued.token);
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    const userId = response.json().data.userId as string;
    const rows = await fixture.db.transaction((tx) =>
      withPlatformTenant(
        tx,
        { agencyId: a.agencyId, companyId: a.companyId, userId },
        (scoped) => scoped.select().from(companyMembers),
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agencyId: a.agencyId,
      companyId: a.companyId,
      userId,
      role: "super_admin",
      status: "active",
      name: "Accepted manager",
    });
    expect((await stored(issued.inviteId))[0].acceptedAt).toEqual(
      fixture.now(),
    );
    expect(await fixture.sessionRows(userId)).toEqual([]);
    expect(
      await fixture.rows(
        sql`select actor_user_id, actor_role, agency_id, company_id, target_id, data from audit_log where action='company.member_accepted'`,
      ),
    ).toEqual([
      {
        actor_user_id: userId,
        actor_role: "super_admin",
        agency_id: a.agencyId,
        company_id: a.companyId,
        target_id: rows[0].id,
        data: { inviteId: issued.inviteId, inviterId: a.user.id },
      },
    ]);
    expect((await accept(issued.token)).statusCode).toBe(404);
  });

  it("adds a membership in another agency while retaining the existing user name and memberships", async () => {
    const { a, b } = await fixture.setup();
    const user = await fixture.seedUser();
    const original = await fixture.seedMember(b, user.id);
    const issued = await fixture.companyInvite(a, { email: user.email });
    expect((await accept(issued.token)).json()).toEqual({
      ok: true,
      data: { userId: user.id },
    });
    expect(
      await fixture.db.transaction((tx) =>
        tx.select().from(users).where(eq(users.id, user.id)),
      ),
    ).toEqual([user]);
    const member = await fixture.db.transaction((tx) =>
      withPlatformTenant(
        tx,
        { agencyId: a.agencyId, companyId: a.companyId, userId: user.id },
        (scoped) => scoped.select().from(companyMembers),
      ),
    );
    expect(member[0]).toMatchObject({
      name: user.name,
      userId: user.id,
      role: "super_admin",
    });
    expect(
      await fixture.db.transaction((tx) =>
        withPlatformTenant(
          tx,
          { agencyId: b.agencyId, companyId: b.companyId, userId: user.id },
          (scoped) => scoped.select().from(companyMembers),
        ),
      ),
    ).toEqual([original]);
  });

  it.each(["active", "deactivated", "invited"] as const)(
    "refuses an existing %s target membership without changing it",
    async (status) => {
      const { a } = await fixture.setup();
      const user = await fixture.seedUser();
      const original = await fixture.seedMember(a, user.id, status);
      const issued = await fixture.companyInvite(a, { email: user.email });
      expect((await accept(issued.token)).statusCode).toBe(409);
      expect((await stored(issued.inviteId))[0].acceptedAt).toBeNull();
      expect(
        await fixture.db.transaction((tx) =>
          withPlatformTenant(
            tx,
            { agencyId: a.agencyId, companyId: a.companyId, userId: user.id },
            (scoped) => scoped.select().from(companyMembers),
          ),
        ),
      ).toEqual([original]);
    },
  );

  it("refuses owner, staff and globally inactive recipients", async () => {
    const { owner, a } = await fixture.setup();
    const inactive = await fixture.seedUser();
    await fixture.db.transaction((tx) =>
      tx
        .update(users)
        .set({ deactivatedAt: fixture.now() })
        .where(eq(users.id, inactive.id)),
    );
    for (const user of [owner.user, a.user, inactive]) {
      const issued = await fixture.companyInvite(a, { email: user.email });
      expect((await accept(issued.token)).statusCode).toBe(409);
      expect((await stored(issued.inviteId))[0].acceptedAt).toBeNull();
    }
  });

  it.each(["expired", "revoked", "used"])(
    "rejects a %s token for preview and acceptance",
    async (state) => {
      const { a } = await fixture.setup();
      const issued = await fixture.companyInvite(a);
      await fixture.db.transaction((tx) =>
        tx
          .update(invites)
          .set(
            state === "expired"
              ? { expiresAt: fixture.now() }
              : state === "revoked"
                ? { revokedAt: fixture.now() }
                : { acceptedAt: fixture.now() },
          )
          .where(eq(invites.id, issued.inviteId)),
      );
      expect(
        (await fixture.post("inspectInvite", { token: issued.token }))
          .statusCode,
      ).toBe(404);
      expect((await accept(issued.token)).statusCode).toBe(404);
      expect(
        await fixture.db.transaction((tx) =>
          tx.select().from(users).where(eq(users.email, issued.input.email)),
        ),
      ).toEqual([]);
    },
  );

  it("consumes once across simultaneous requests and applies the persistent acceptance limit", async () => {
    const { a } = await fixture.setup();
    const issued = await fixture.companyInvite(a);
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) => accept(issued.token, index % 2)),
    );
    expect(responses.filter((row) => row.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((row) => row.statusCode === 404)).toHaveLength(9);
    const limited = await accept(issued.token);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(
      await fixture.rows(
        sql`select count(*)::int as count from audit_log where action='company.member_accepted'`,
      ),
    ).toEqual([{ count: 1 }]);
  });

  it.each(["audit_log", "company_members"])(
    "rolls back user, membership and token if %s refuses insertion",
    async (table) => {
      const { a } = await fixture.setup();
      const issued = await fixture.companyInvite(a);
      const before = await stored(issued.inviteId);
      await fixture.owner(`REVOKE INSERT ON ${table} FROM anar_app`);
      try {
        expect((await accept(issued.token)).statusCode).toBe(500);
        expect(await stored(issued.inviteId)).toEqual(before);
        expect(
          await fixture.db.transaction((tx) =>
            tx.select().from(users).where(eq(users.email, issued.input.email)),
          ),
        ).toEqual([]);
        expect(
          await fixture.rows(
            sql`select id from audit_log where action='company.member_accepted'`,
          ),
        ).toEqual([]);
      } finally {
        await fixture.owner(`GRANT INSERT ON ${table} TO anar_app`);
      }
    },
  );

  it.each(["user", "staff", "agency", "company"])(
    "rejects acceptance after queued issuer %s removal commits",
    async (kind) => {
      const { a } = await fixture.setup();
      const recipient = await fixture.seedUser();
      const issued = await fixture.companyInvite(a, { email: recipient.email });
      const held = await fixture.holdUser(a.user.id, async (tx) => {
        if (kind === "user")
          await tx
            .update(users)
            .set({ deactivatedAt: fixture.now() })
            .where(eq(users.id, a.user.id));
        if (kind === "agency")
          await tx
            .update(agencies)
            .set({ status: "suspended" })
            .where(eq(agencies.id, a.agencyId));
        await withPlatformAgency(
          tx,
          { agencyId: a.agencyId, userId: a.user.id },
          async (scoped) => {
            if (kind === "staff")
              await scoped
                .update(agencyMembers)
                .set({ status: "deactivated" })
                .where(eq(agencyMembers.userId, a.user.id));
            if (kind === "company")
              await scoped
                .update(companies)
                .set({ status: "suspended" })
                .where(eq(companies.id, a.companyId));
          },
        );
      });
      const pending = accept(issued.token);
      try {
        await fixture.waitForLock();
      } finally {
        held.release();
        await held.done;
      }
      expect((await pending).statusCode).toBe(404);
      expect((await stored(issued.inviteId))[0].acceptedAt).toBeNull();
    },
  );

  it.each([
    { role: "admin" as const, status: "active" as const },
    { role: "super_admin" as const, status: "deactivated" as const },
  ])(
    "rejects an issuer with $status $role membership",
    async ({ role, status }) => {
      const { a } = await fixture.setup();
      const issuer = await fixture.seedUser();
      await fixture.seedMember(a, issuer.id, status, role);
      const issued = await fixture.companyInvite(a);
      await fixture.db.transaction((tx) =>
        tx
          .update(invites)
          .set({ role: "admin", createdBy: issuer.id })
          .where(eq(invites.id, issued.inviteId)),
      );
      const before = await stored(issued.inviteId);
      expect(
        (await fixture.post("inspectInvite", { token: issued.token }))
          .statusCode,
      ).toBe(404);
      expect((await accept(issued.token)).statusCode).toBe(404);
      expect(await stored(issued.inviteId)).toEqual(before);
      expect(
        await fixture.db.transaction((tx) =>
          tx.select().from(users).where(eq(users.email, issued.input.email)),
        ),
      ).toEqual([]);
    },
  );

  it("allows a current company Super Admin to issue Admin membership only", async () => {
    const { a, b } = await fixture.setup();
    const manager = await fixture.seedUser();
    await fixture.seedMember(a, manager.id);
    for (const [role, issuer, target, expected] of [
      ["admin", manager.id, a, 200],
      ["super_admin", manager.id, a, 404],
      ["admin", manager.id, b, 404],
      ["admin", a.user.id, a, 200],
    ] as const) {
      const issued = await fixture.companyInvite(target);
      await fixture.db.transaction((tx) =>
        tx
          .update(invites)
          .set({ role, createdBy: issuer })
          .where(eq(invites.id, issued.inviteId)),
      );
      expect(
        (await fixture.post("inspectInvite", { token: issued.token }))
          .statusCode,
      ).toBe(expected);
      const response = await accept(issued.token);
      expect(response.statusCode).toBe(expected);
      if (expected === 200) {
        const rows = await fixture.db.transaction((tx) =>
          withPlatformTenant(
            tx,
            {
              agencyId: target.agencyId,
              companyId: target.companyId,
              userId: response.json().data.userId,
            },
            (scoped) =>
              scoped
                .select()
                .from(companyMembers)
                .where(eq(companyMembers.userId, response.json().data.userId)),
          ),
        );
        expect(rows[0].role).toBe("admin");
      }
    }
  });
});
