import { randomBytes } from "node:crypto";
import {
  agencies,
  agencyMembers,
  invites,
  users,
  withPlatformAgency,
  withPlatformIdentity,
  withPlatformTenant,
} from "@anar/db/platform";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import context from "../../src/modules/agencies/context.js";
import { type AgencyFixture, startAgencyFixture } from "./fixture.js";

describe("initial invite acceptance and agency scope", () => {
  let fixture: AgencyFixture;
  beforeAll(async () => {
    fixture = await startAgencyFixture();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await fixture?.close();
  });
  async function pending(email?: string) {
    const owner = await fixture.login({ owner: true });
    return {
      owner,
      ...(await fixture.invite(owner.cookie, email ? { email } : {})),
    };
  }
  const accept = (token: string, index = 0) =>
    fixture.post("acceptInvite", { token, name: "Accepted name" }, { index });
  async function state(agencyId: string) {
    return fixture.db.transaction((tx) =>
      withPlatformAgency(tx, { agencyId, userId: v7() }, async (scoped) => ({
        staff: await scoped.select().from(agencyMembers),
        agency: (
          await scoped.select().from(agencies).where(eq(agencies.id, agencyId))
        )[0],
        invite: (
          await scoped
            .select()
            .from(invites)
            .where(eq(invites.agencyId, agencyId))
        )[0],
      })),
    );
  }

  it("inspects without consuming, accepts once, and still requires login", async () => {
    const issued = await pending();
    for (let i = 0; i < 2; i++) {
      const preview = await fixture.post("inspectInvite", {
        token: issued.token,
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json().data).toEqual({
        kind: "agency_staff",
        email: issued.details.email,
        name: issued.details.staffName,
        agencyName: issued.details.name,
        companyName: null,
        expiresAt: new Date(
          fixture.now().getTime() + 7 * 86400000,
        ).toISOString(),
      });
      expect(preview.headers["cache-control"]).toBe("private, no-store");
      expect(preview.headers["set-cookie"]).toBeUndefined();
    }
    expect((await state(issued.agencyId)).invite.acceptedAt).toBeNull();
    const response = await accept(issued.token);
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    const { userId } = response.json().data;
    const current = await state(issued.agencyId);
    expect(current.agency.status).toBe("active");
    expect(current.invite.acceptedAt).toEqual(fixture.now());
    expect(current.staff).toHaveLength(1);
    expect(current.staff[0]).toMatchObject({
      userId,
      agencyId: issued.agencyId,
      status: "active",
      invitedBy: issued.owner.user.id,
    });
    expect(
      await fixture.rows(
        sql`select name,platform_role from users where id=${userId}`,
      ),
    ).toEqual([{ name: "Accepted name", platform_role: null }]);
    expect(await fixture.sessionRows(userId)).toEqual([]);
    expect(
      await fixture.rows(
        sql`select actor_role,agency_id,company_id,target_id,data from audit_log where action='agency.staff_accepted'`,
      ),
    ).toEqual([
      {
        actor_role: "agency_staff",
        agency_id: issued.agencyId,
        company_id: null,
        target_id: current.staff[0].id,
        data: { inviteId: issued.inviteId, inviterId: issued.owner.user.id },
      },
    ]);
    expect((await accept(issued.token)).statusCode).toBe(404);
    expect(
      (await fixture.post("inspectInvite", { token: issued.token })).statusCode,
    ).toBe(404);
  });

  it("keeps the name and ID of an existing ordinary user", async () => {
    const user = await fixture.seedUser();
    const issued = await pending(user.email.toUpperCase());
    const response = await accept(issued.token);
    expect(response.json().data).toEqual({ userId: user.id });
    expect(
      await fixture.rows(sql`select name from users where id=${user.id}`),
    ).toEqual([{ name: user.name }]);
  });

  it.each(["owner", "inactive", "staff", "inactive-staff"])(
    "refuses an existing %s without consuming the token",
    async (kind) => {
      const owner = await fixture.login({ owner: true });
      const user = kind === "owner" ? owner.user : await fixture.seedUser();
      if (kind === "inactive")
        await fixture.db.transaction((tx) =>
          tx
            .update(users)
            .set({ deactivatedAt: fixture.now() })
            .where(eq(users.id, user.id)),
        );
      if (kind.includes("staff")) {
        const first = await fixture.invite(owner.cookie, { email: user.email });
        expect((await accept(first.token)).statusCode).toBe(200);
        if (kind === "inactive-staff")
          await fixture.db.transaction((tx) =>
            withPlatformAgency(
              tx,
              { agencyId: first.agencyId, userId: user.id },
              (scoped) =>
                scoped
                  .update(agencyMembers)
                  .set({ status: "deactivated", deactivatedAt: fixture.now() })
                  .where(eq(agencyMembers.userId, user.id)),
            ),
          );
      }
      const issued = await fixture.invite(owner.cookie, { email: user.email });
      expect((await accept(issued.token)).statusCode).toBe(409);
      const current = await state(issued.agencyId);
      expect(current.staff).toEqual([]);
      expect(current.agency.status).toBe("pending");
      expect(current.invite.acceptedAt).toBeNull();
    },
  );

  it.each([
    "expired",
    "revoked",
    "accepted",
    "active-agency",
    "suspended-agency",
    "inactive-owner",
  ])("hides %s invitations from inspect and accept", async (kind) => {
    const issued = await pending();
    await fixture.db.transaction(async (tx) => {
      if (kind === "inactive-owner")
        await tx
          .update(users)
          .set({ deactivatedAt: fixture.now() })
          .where(eq(users.id, issued.owner.user.id));
      else if (kind.endsWith("agency"))
        await tx
          .update(agencies)
          .set({ status: kind === "active-agency" ? "active" : "suspended" })
          .where(eq(agencies.id, issued.agencyId));
      else
        await tx
          .update(invites)
          .set({
            ...(kind === "expired" ? { expiresAt: fixture.now() } : {}),
            ...(kind === "revoked" ? { revokedAt: fixture.now() } : {}),
            ...(kind === "accepted" ? { acceptedAt: fixture.now() } : {}),
          })
          .where(eq(invites.id, issued.inviteId));
    });
    expect(
      (await fixture.post("inspectInvite", { token: issued.token })).statusCode,
    ).toBe(404);
    expect((await accept(issued.token)).statusCode).toBe(404);
    expect(
      await fixture.rows(
        sql`select id from users where email=${issued.details.email}`,
      ),
    ).toEqual([]);
    expect((await state(issued.agencyId)).staff).toEqual([]);
  });

  it("rolls back the user, membership, activation and token when audit fails", async () => {
    const issued = await pending();
    await fixture.owner("REVOKE INSERT ON audit_log FROM anar_app");
    try {
      expect((await accept(issued.token)).statusCode).toBe(500);
      const current = await state(issued.agencyId);
      expect(current.staff).toEqual([]);
      expect(current.agency.status).toBe("pending");
      expect(current.invite.acceptedAt).toBeNull();
      expect(
        await fixture.rows(
          sql`select id from users where email=${issued.details.email}`,
        ),
      ).toEqual([]);
    } finally {
      await fixture.owner("GRANT INSERT ON audit_log TO anar_app");
    }
    expect((await accept(issued.token)).statusCode).toBe(200);
  });

  it("allows only one concurrent acceptance of a token", async () => {
    const issued = await pending();
    const responses = await Promise.all([
      accept(issued.token, 0),
      accept(issued.token, 1),
    ]);
    expect(responses.filter((row) => row.statusCode === 200)).toHaveLength(1);
    expect(
      responses.filter((row) => [404, 409].includes(row.statusCode)),
    ).toHaveLength(1);
    expect((await state(issued.agencyId)).staff).toHaveLength(1);
    expect(
      await fixture.rows(
        sql`select count(*)::int as count from audit_log where action='agency.staff_accepted'`,
      ),
    ).toEqual([{ count: 1 }]);
  });

  it("allows only one agency when two invitations race for the same new user", async () => {
    const first = await pending();
    const second = await fixture.invite(first.owner.cookie, {
      email: first.details.email,
    });
    const responses = await Promise.all([
      accept(first.token, 0),
      accept(second.token, 1),
    ]);
    expect(responses.map((row) => row.statusCode).sort()).toEqual([200, 409]);
    const states = await Promise.all([
      state(first.agencyId),
      state(second.agencyId),
    ]);
    expect(states.map((row) => row.agency.status).sort()).toEqual([
      "active",
      "pending",
    ]);
    expect(states.flatMap((row) => row.staff)).toHaveLength(1);
  });

  it.each(["issuer", "recipient"])(
    "rechecks the %s after deactivation commits",
    async (target) => {
      const recipient = await fixture.seedUser();
      const issued = await pending(recipient.email);
      const id = target === "issuer" ? issued.owner.user.id : recipient.id;
      const hold = await fixture.holdUser(id, async (tx) => {
        await tx
          .update(users)
          .set({ deactivatedAt: fixture.now() })
          .where(eq(users.id, id));
      });
      const response = accept(issued.token);
      try {
        await fixture.waitForLock();
      } finally {
        hold.release();
        await hold.done;
      }
      expect((await response).statusCode).toBe(target === "issuer" ? 404 : 409);
      expect((await state(issued.agencyId)).staff).toEqual([]);
    },
  );

  it.each([
    ["inspectInvite", 60, 60000],
    ["acceptInvite", 10, 3600000],
  ] as const)(
    "shares the %s limit across instances and counts failures",
    async (path, max, window) => {
      const token = randomBytes(32).toString("base64url");
      const payload =
        path === "acceptInvite" ? { token, name: "Nobody" } : { token };
      for (let i = 0; i < max; i++)
        expect(
          (await fixture.post(path, payload, { index: i % 2 })).statusCode,
        ).toBe(404);
      const denied = await fixture.post(path, payload, { index: 1 });
      expect(denied.statusCode).toBe(429);
      expect(Number(denied.headers["retry-after"])).toBe(window / 1000);
      expect(denied.json()).toMatchObject({ error: "validation" });
      fixture.advance(window);
      expect((await fixture.post(path, payload)).statusCode).toBe(404);
      expect(
        (await fixture.post(path, payload, { ip: "198.51.100.99" })).statusCode,
      ).toBe(404);
    },
  );

  it("checks Origin before admission and rejects forged acceptance fields", async () => {
    const issued = await pending();
    for (const path of ["inspectInvite", "acceptInvite"])
      expect(
        (
          await fixture.post(
            path,
            { token: issued.token, name: "Name" },
            { origin: "https://hostile.example" },
          )
        ).statusCode,
      ).toBe(403);
    expect(
      (await fixture.limits()).filter((row) => row.scope.startsWith("invite.")),
    ).toEqual([]);
    expect(
      (
        await fixture.post("acceptInvite", {
          token: issued.token,
          name: "Name",
          userId: issued.owner.user.id,
        })
      ).statusCode,
    ).toBe(400);
    expect((await state(issued.agencyId)).invite.acceptedAt).toBeNull();
  });

  it("enforces RLS and clears every unused scope selector", async () => {
    const first = await pending();
    const second = await fixture.invite(first.owner.cookie);
    const a = (await accept(first.token)).json().data.userId as string;
    const b = (await accept(second.token)).json().data.userId as string;
    expect(
      await fixture.db.transaction((tx) => tx.select().from(agencyMembers)),
    ).toEqual([]);
    await fixture.db.transaction(async (tx) => {
      const scope = { agencyId: first.agencyId, companyId: v7(), userId: a };
      await withPlatformTenant(tx, scope, async (scoped) => {
        expect(
          (await scoped.select().from(agencyMembers)).map((row) => row.userId),
        ).toEqual([a]);
      });
      await withPlatformIdentity(tx, b, async (scoped) => {
        expect(
          (await scoped.select().from(agencyMembers)).map((row) => row.userId),
        ).toEqual([b]);
        expect(
          (
            await scoped.execute(
              sql`select current_setting('app.scope_kind') as kind, current_setting('app.agency_id') as agency, current_setting('app.company_id') as company, current_setting('app.user_id') as usr`,
            )
          ).rows,
        ).toEqual([{ kind: "identity", agency: "", company: "", usr: b }]);
        expect(
          await scoped
            .update(agencyMembers)
            .set({ status: "deactivated" })
            .returning(),
        ).toEqual([]);
      });
      await withPlatformAgency(
        tx,
        { agencyId: first.agencyId, userId: a },
        async (scoped) => {
          expect(
            (
              await scoped.execute(
                sql`select current_setting('app.scope_kind') as kind, current_setting('app.company_id') as company`,
              )
            ).rows,
          ).toEqual([{ kind: "agency", company: "" }]);
          expect(
            await scoped
              .update(agencyMembers)
              .set({ status: "deactivated" })
              .where(eq(agencyMembers.userId, b))
              .returning(),
          ).toEqual([]);
        },
      );
    });
    expect(
      await fixture.rows(
        sql`select relrowsecurity,relforcerowsecurity from pg_class where oid='agency_members'::regclass`,
      ),
    ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    expect(
      await fixture.rows(
        sql`select has_table_privilege(current_user,'agency_members','DELETE') as del, has_table_privilege(current_user,'agency_members','TRUNCATE') as trunc`,
      ),
    ).toEqual([{ del: false, trunc: false }]);
    const unused = await fixture.seedUser();
    await expect(
      fixture.db.transaction((tx) =>
        withPlatformIdentity(tx, a, (scoped) =>
          scoped.insert(agencyMembers).values({
            id: v7(),
            agencyId: first.agencyId,
            userId: unused.id,
            status: "active",
            invitedBy: first.owner.user.id,
          }),
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(
      fixture.db.transaction((tx) =>
        withPlatformAgency(
          tx,
          { agencyId: first.agencyId, userId: a },
          (scoped) =>
            scoped
              .update(agencyMembers)
              .set({ agencyId: second.agencyId })
              .where(eq(agencyMembers.userId, a)),
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("resolves active staff and refuses owner and stale agency contexts", async () => {
    const issued = await pending();
    const response = await accept(issued.token);
    const [user] = await fixture.db.transaction((tx) =>
      tx.select().from(users).where(eq(users.id, response.json().data.userId)),
    );
    const login = await fixture.loginAs(user, { ip: "198.51.100.77" });
    const service = context.create({
      db: fixture.db,
      sessions: fixture.apps[0].sessions,
    });
    await expect(
      service.requireAgencyContext({
        headers: { cookie: issued.owner.cookie },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const actor = await service.requireAgencyContext({
      headers: { cookie: login.cookie },
    });
    expect(actor).toMatchObject({
      role: "agency_staff",
      agencyId: issued.agencyId,
      user: { id: user.id },
    });
    expect(
      await service.withAgencyContext(actor, async (tx) =>
        (await tx.select().from(agencyMembers)).map((row) => row.userId),
      ),
    ).toEqual([user.id]);
    await fixture.db.transaction((tx) =>
      withPlatformAgency(
        tx,
        { agencyId: issued.agencyId, userId: user.id },
        (scoped) =>
          scoped
            .update(agencyMembers)
            .set({ status: "deactivated", deactivatedAt: fixture.now() })
            .where(eq(agencyMembers.userId, user.id)),
      ),
    );
    let called = false;
    await expect(
      service.withAgencyContext(actor, async () => {
        called = true;
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(called).toBe(false);
    await expect(
      service.requireAgencyContext({ headers: { cookie: login.cookie } }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
