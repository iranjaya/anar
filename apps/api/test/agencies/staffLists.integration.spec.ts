import {
  agencies,
  agencyMembers,
  invites,
  sessions,
  users,
  withPlatformAgency,
} from "@anar/db/platform";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import context from "../../src/modules/agencies/context.js";
import staff from "../../src/modules/agencies/staff.js";
import { type AgencyFixture, startAgencyFixture } from "./fixture.js";

describe("current agency and own staff lists", () => {
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
  const paths = ["getAgency", "listStaff", "listInvites"] as const;

  async function onboard(ownerCookie: string, ip: string) {
    const issued = await fixture.invite(ownerCookie);
    const accepted = await fixture.post(
      "acceptInvite",
      { token: issued.token, name: "First staff" },
      { ip },
    );
    expect(accepted.statusCode).toBe(200);
    const [user] = await fixture.db.transaction((tx) =>
      tx.select().from(users).where(eq(users.id, accepted.json().data.userId)),
    );
    const login = await fixture.loginAs(user, { ip });
    return { ...issued, ...login };
  }
  async function setup() {
    const owner = await fixture.login({ owner: true });
    const a = await onboard(owner.cookie, "198.51.100.81");
    const b = await onboard(owner.cookie, "198.51.100.82");
    return { owner, a, b };
  }
  type StaffLogin = Awaited<ReturnType<typeof onboard>>;

  async function seedMembers(target: StaffLogin, count: number) {
    const at = fixture.now();
    const people = Array.from({ length: count }, (_, i) => ({
      id: v7(),
      email: `${v7()}@example.test`,
      name: `Staff ${i}`,
    }));
    const members = people.map((person, i) => ({
      id: v7(),
      agencyId: target.agencyId,
      userId: person.id,
      status: i % 2 ? ("deactivated" as const) : ("active" as const),
      invitedBy: target.user.id,
      deactivatedAt: i % 2 ? at : null,
      createdAt: at,
      updatedAt: at,
    }));
    await fixture.db.transaction(async (tx) => {
      await tx.insert(users).values(people);
      await withPlatformAgency(
        tx,
        { agencyId: target.agencyId, userId: target.user.id },
        (scoped) => scoped.insert(agencyMembers).values(members),
      );
    });
    return members.map((member, i) => ({
      ...member,
      name: people[i].name,
      email: people[i].email,
    }));
  }
  async function seedInvites(target: StaffLogin, count: number) {
    const at = fixture.now();
    const rows = Array.from({ length: count }, (_, i) => ({
      id: v7(),
      agencyId: target.agencyId,
      companyId: null,
      email: `${v7()}@example.test`,
      name: `Invite ${i}`,
      role: "agency_staff" as const,
      tokenHash: `proof-${v7()}`,
      expiresAt: new Date(at.getTime() + (i % 2 ? -1 : 86400000)),
      createdBy: target.user.id,
      createdAt: at,
    }));
    await fixture.db.transaction((tx) => tx.insert(invites).values(rows));
    return rows;
  }

  it("returns the current agency and staff with only public fields", async () => {
    const { a } = await setup();
    const response = await fixture.request("GET", "getAgency", a.cookie);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["set-cookie"]).toBeUndefined();
    const view = response.json().data;
    expect(Object.keys(view).sort()).toEqual([
      "agency",
      "capabilities",
      "staff",
    ]);
    expect(view.agency).toEqual({
      id: a.agencyId,
      name: a.details.name,
      slug: a.details.slug,
      status: "active",
      createdAt: fixture.now().toISOString(),
    });
    expect(view.staff).toMatchObject({
      userId: a.user.id,
      agencyId: a.agencyId,
      email: a.user.email,
      name: a.user.name,
      status: "active",
    });
    expect(Object.keys(view.staff).sort()).toEqual([
      "agencyId",
      "createdAt",
      "deactivatedAt",
      "email",
      "id",
      "invitedBy",
      "name",
      "status",
      "updatedAt",
      "userId",
    ]);
    expect(view.capabilities).toContain("agency.staff.list");
    expect(view.capabilities).not.toContain("agency.create");
    expect(response.body).not.toContain(a.token);
    expect(response.body).not.toContain("tokenHash");
    expect(response.body).not.toContain("createdBy");
  });

  it("keeps staff, profile emails and invitations inside their own agency", async () => {
    const { a, b } = await setup();
    const [aMembers, bMembers, aInvites, bInvites] = await Promise.all([
      seedMembers(a, 2),
      seedMembers(b, 2),
      seedInvites(a, 2),
      seedInvites(b, 2),
    ]);
    for (const [actor, members, pending, foreignMembers, foreignInvites] of [
      [a, aMembers, aInvites, bMembers, bInvites],
      [b, bMembers, bInvites, aMembers, aInvites],
    ] as const) {
      const staffResponse = await fixture.request(
        "GET",
        "listStaff",
        actor.cookie,
      );
      expect(staffResponse.statusCode).toBe(200);
      const page = staffResponse.json().data;
      expect(
        page.items.map((member: { userId: string }) => member.userId).sort(),
      ).toEqual([actor.user.id, ...members.map((m) => m.userId)].sort());
      expect(
        page.items.find(
          (member: { userId: string }) => member.userId === actor.user.id,
        ),
      ).toMatchObject({
        name: actor.user.name,
        email: actor.user.email,
      });
      for (const member of members) {
        expect(
          page.items.find(
            (row: { userId: string }) => row.userId === member.userId,
          ),
        ).toEqual({
          ...member,
          createdAt: member.createdAt.toISOString(),
          updatedAt: member.updatedAt.toISOString(),
          deactivatedAt: member.deactivatedAt?.toISOString() ?? null,
        });
      }
      expect(
        page.items.some(
          (member: { status: string }) => member.status === "deactivated",
        ),
      ).toBe(true);
      const inviteResponse = await fixture.request(
        "GET",
        "listInvites",
        actor.cookie,
      );
      expect(inviteResponse.statusCode).toBe(200);
      expect(
        inviteResponse
          .json()
          .data.items.map((invite: { id: string }) => invite.id)
          .sort(),
      ).toEqual(pending.map((row) => row.id).sort());
      for (const invite of pending) {
        expect(
          inviteResponse
            .json()
            .data.items.find((row: { id: string }) => row.id === invite.id),
        ).toEqual({
          id: invite.id,
          name: invite.name,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt.toISOString(),
          createdAt: invite.createdAt.toISOString(),
        });
      }
      for (const foreign of [...foreignMembers, ...foreignInvites]) {
        expect(staffResponse.body).not.toContain(foreign.email);
        expect(inviteResponse.body).not.toContain(foreign.email);
      }
    }
    expect(
      await fixture.db.transaction((tx) => tx.select().from(agencyMembers)),
    ).toEqual([]);
  });

  it("keeps expired pending invites visible and excludes accepted or revoked ones", async () => {
    const { a } = await setup();
    const pending = await seedInvites(a, 4);
    await fixture.db.transaction(async (tx) => {
      await tx
        .update(invites)
        .set({ acceptedAt: fixture.now() })
        .where(eq(invites.id, pending[2].id));
      await tx
        .update(invites)
        .set({ revokedAt: fixture.now() })
        .where(eq(invites.id, pending[3].id));
    });
    const response = await fixture.request("GET", "listInvites", a.cookie);
    const page = response.json().data;
    expect(page.items.map((row: { id: string }) => row.id).sort()).toEqual(
      pending
        .slice(0, 2)
        .map((row) => row.id)
        .sort(),
    );
    for (const row of page.items)
      expect(Object.keys(row).sort()).toEqual([
        "createdAt",
        "email",
        "expiresAt",
        "id",
        "name",
        "role",
      ]);
    expect(
      page.items.some(
        (row: { expiresAt: string }) =>
          new Date(row.expiresAt).getTime() < fixture.now().getTime(),
      ),
    ).toBe(true);
    for (const invite of pending)
      expect(response.body).not.toContain(invite.tokenHash);
    const before = await fixture.db.transaction((tx) =>
      tx.select().from(invites),
    );
    await fixture.request("GET", "listInvites", a.cookie);
    expect(
      await fixture.db.transaction((tx) => tx.select().from(invites)),
    ).toEqual(before);
  });

  it.each(["listStaff", "listInvites"] as const)(
    "pages equal timestamps without duplicates in %s",
    async (path) => {
      const { a } = await setup();
      const seeded =
        path === "listStaff"
          ? await seedMembers(a, 50)
          : await seedInvites(a, 51);
      const expected = seeded.map((row) => row.id);
      if (path === "listStaff") {
        const view = (
          await fixture.request("GET", "getAgency", a.cookie)
        ).json().data;
        expected.push(view.staff.id);
      }
      expected.sort().reverse();
      const first = await fixture.request("GET", path, a.cookie);
      expect(first.statusCode).toBe(200);
      const page = first.json().data;
      expect(page.items).toHaveLength(50);
      const last = await fixture.request(
        "GET",
        `${path}?cursor=${page.nextCursor}`,
        a.cookie,
      );
      expect(last.statusCode).toBe(200);
      const tail = last.json().data;
      expect(tail.items).toHaveLength(1);
      expect(tail.nextCursor).toBeNull();
      expect(
        [...page.items, ...tail.items].map((row: { id: string }) => row.id),
      ).toEqual(expected);
      expect(
        (await fixture.request("GET", `${path}?cursor=garbage`, a.cookie))
          .statusCode,
      ).toBe(400);
    },
  );

  it("keeps invites separate from staff and returns an empty invite page", async () => {
    const { a } = await setup();
    expect(
      (await fixture.request("GET", "listInvites", a.cookie)).json().data,
    ).toEqual({ items: [], nextCursor: null });
    await seedInvites(a, 2);
    expect(
      (await fixture.request("GET", "listStaff", a.cookie)).json().data.items,
    ).toHaveLength(1);
  });

  it("denies anonymous, owner and ordinary identities", async () => {
    const { owner } = await setup();
    const ordinary = await fixture.login({ ip: "198.51.100.83" });
    for (const cookie of [undefined, owner.cookie, ordinary.cookie])
      for (const path of paths) {
        expect((await fixture.request("GET", path, cookie)).statusCode).toBe(
          cookie ? 403 : 401,
        );
      }
  });

  it.each(["pending", "suspended", "closing"] as const)(
    "denies reads from a %s agency",
    async (status) => {
      const { a } = await setup();
      await fixture.db.transaction((tx) =>
        tx.update(agencies).set({ status }).where(eq(agencies.id, a.agencyId)),
      );
      for (const path of paths)
        expect((await fixture.request("GET", path, a.cookie)).statusCode).toBe(
          403,
        );
    },
  );

  it.each(["membership", "user", "session", "expired"])(
    "denies a cached context after %s access changes",
    async (kind) => {
      const { a } = await setup();
      const service = staff.create(
        context.create({ db: fixture.db, sessions: fixture.apps[0].sessions }),
      );
      const actor = await service.requireAgencyContext({
        headers: { cookie: a.cookie },
      });
      await fixture.db.transaction(async (tx) => {
        if (kind === "membership")
          await withPlatformAgency(
            tx,
            { agencyId: a.agencyId, userId: a.user.id },
            (scoped) =>
              scoped
                .update(agencyMembers)
                .set({ status: "deactivated", deactivatedAt: fixture.now() })
                .where(eq(agencyMembers.userId, a.user.id)),
          );
        if (kind === "user")
          await tx
            .update(users)
            .set({ deactivatedAt: fixture.now() })
            .where(eq(users.id, a.user.id));
        if (kind === "session")
          await tx
            .update(sessions)
            .set({ revokedAt: fixture.now() })
            .where(eq(sessions.id, actor.session.id));
        if (kind === "expired")
          await tx
            .update(sessions)
            .set({ expiresAt: fixture.now() })
            .where(eq(sessions.id, actor.session.id));
      });
      const code = kind === "membership" ? "forbidden" : "unauthorized";
      await expect(service.getAgency(actor)).rejects.toMatchObject({ code });
      await expect(service.listStaff(actor, {})).rejects.toMatchObject({
        code,
      });
      await expect(service.listStaffInvites(actor, {})).rejects.toMatchObject({
        code,
      });
      for (const path of paths)
        expect((await fixture.request("GET", path, a.cookie)).statusCode).toBe(
          kind === "membership" ? 403 : 401,
        );
    },
  );

  it("rejects browser-supplied agency, user and role selectors", async () => {
    const { a, b } = await setup();
    for (const path of paths)
      for (const query of [
        `agencyId=${b.agencyId}`,
        `userId=${b.user.id}`,
        "role=owner",
      ]) {
        expect(
          (await fixture.request("GET", `${path}?${query}`, a.cookie))
            .statusCode,
        ).toBe(400);
      }
    expect(
      (await fixture.request("GET", "getAgency?cursor=anything", a.cookie))
        .statusCode,
    ).toBe(400);
  });

  it("allows reads with stale OTP and never invents an empty page on a database failure", async () => {
    const { a } = await setup();
    fixture.advance(15 * 60000 + 1);
    for (const path of paths)
      expect((await fixture.request("GET", path, a.cookie)).statusCode).toBe(
        200,
      );
    await fixture.owner("REVOKE SELECT ON invites FROM anar_app");
    try {
      const response = await fixture.request("GET", "listInvites", a.cookie);
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        ok: false,
        error: "unavailable",
      });
    } finally {
      await fixture.owner("GRANT SELECT ON invites TO anar_app");
    }
  });

  it("serves all three reads through the compiled API registration", async () => {
    const { a } = await setup();
    const api = await fixture.startApi();
    try {
      for (const path of paths) {
        const response = await fetch(`${api.url}/api/agencies/${path}`, {
          headers: { cookie: a.cookie },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        const body = (await response.json()) as { ok: boolean; data: unknown };
        expect(body.ok).toBe(true);
      }
    } finally {
      await fixture.stopProcesses();
    }
    expect(fixture.processLogs.join("")).not.toContain(a.user.email);
  });

  it("has millisecond invite timestamps and both list indexes in the initial schema", async () => {
    expect(
      await fixture.rows(
        sql`select datetime_precision from information_schema.columns where table_schema='public' and table_name='invites' and column_name='created_at'`,
      ),
    ).toEqual([{ datetime_precision: 3 }]);
    expect(
      await fixture.rows(
        sql`select indexname from pg_indexes where schemaname='public' and indexname in ('invites_agency_created_idx','agency_members_agency_created_idx') order by indexname`,
      ),
    ).toEqual([
      { indexname: "agency_members_agency_created_idx" },
      { indexname: "invites_agency_created_idx" },
    ]);
  });
});
