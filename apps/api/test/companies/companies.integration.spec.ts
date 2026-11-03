import {
  agencies,
  agencyMembers,
  auditLog,
  companies,
  sessions,
  users,
  withPlatformAgency,
  withPlatformIdentity,
  withPlatformTenant,
} from "@anar/db/platform";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import context from "../../src/modules/agencies/context.js";
import companyService from "../../src/modules/companies/service.js";
import { type AgencyFixture, startAgencyFixture } from "../agencies/fixture.js";
import { publicOrigin } from "../auth/fixture.js";

describe("own agency company shells", () => {
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
  const input = (overrides: object = {}) => ({
    name: "Proof company",
    slug: `company-${v7()}`,
    defaultCountry: "NP" as const,
    timezone: "Asia/Kathmandu" as const,
    ...overrides,
  });
  const request = (
    method: "GET" | "POST",
    path: string,
    cookie?: string,
    payload?: object,
    origin = publicOrigin,
  ) =>
    fixture.apps[0].app.inject({
      method,
      url: `/api/companies/${path}`,
      payload,
      headers: { origin, ...(cookie ? { cookie } : {}) },
    });
  async function onboard(cookie: string, ip: string) {
    const invitation = await fixture.invite(cookie);
    const accepted = await fixture.post(
      "acceptInvite",
      { token: invitation.token, name: "Staff" },
      { ip },
    );
    expect(accepted.statusCode).toBe(200);
    const [user] = await fixture.db.transaction((tx) =>
      tx.select().from(users).where(eq(users.id, accepted.json().data.userId)),
    );
    return { ...invitation, ...(await fixture.loginAs(user, { ip })) };
  }
  async function setup() {
    const owner = await fixture.login({ owner: true });
    const a = await onboard(owner.cookie, "198.51.100.81");
    const b = await onboard(owner.cookie, "198.51.100.82");
    return { owner, a, b };
  }
  type Staff = Awaited<ReturnType<typeof onboard>>;
  async function create(actor: Staff, details = input()) {
    const response = await request(
      "POST",
      "createCompany",
      actor.cookie,
      details,
    );
    expect(response.statusCode).toBe(200);
    return { id: response.json().data.companyId as string, details };
  }
  const stored = (actor: Staff) =>
    fixture.db.transaction((tx) =>
      withPlatformAgency(
        tx,
        { agencyId: actor.agencyId, userId: actor.user.id },
        (scoped) => scoped.select().from(companies),
      ),
    );

  it("creates only a shell with server-derived agency, exact settings and atomic audit", async () => {
    const { a } = await setup();
    const created = await create(a);
    const [row] = await stored(a);
    expect(row).toEqual({
      id: created.id,
      agencyId: a.agencyId,
      ...created.details,
      status: "active",
      settings: { super_admin_can_import: false },
      createdAt: fixture.now(),
      updatedAt: fixture.now(),
    });
    const audits = await fixture.rows(
      sql`select actor_user_id, actor_role, agency_id, company_id, target_type, target_id, data from audit_log where action='company.created'`,
    );
    expect(audits).toEqual([
      {
        actor_user_id: a.user.id,
        actor_role: "agency_staff",
        agency_id: a.agencyId,
        company_id: created.id,
        target_type: "company",
        target_id: created.id,
        data: { companyId: created.id },
      },
    ]);
  });

  it("lists only the current agency with exact public summaries", async () => {
    const { a, b } = await setup();
    const own = await create(a);
    const foreign = await create(b);
    for (const [actor, expected] of [
      [a, own],
      [b, foreign],
    ] as const) {
      const response = await request("GET", "listCompanies", actor.cookie);
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.json()).toEqual({
        ok: true,
        data: {
          items: [
            {
              id: expected.id,
              agencyId: actor.agencyId,
              ...expected.details,
              status: "active",
              memberCount: 0,
              leadCount: 0,
              lastImportAt: null,
            },
          ],
          nextCursor: null,
        },
      });
    }
  });

  it("pages equal timestamps without omissions or repeats", async () => {
    const { a, b } = await setup();
    await create(b);
    const rows = Array.from({ length: 103 }, () => ({
      id: v7(),
      agencyId: a.agencyId,
      ...input(),
      status: "active" as const,
      defaultCountry: "NP" as const,
      timezone: "Asia/Kathmandu" as const,
      createdAt: fixture.now(),
      updatedAt: fixture.now(),
    }));
    await fixture.db.transaction((tx) =>
      withPlatformAgency(
        tx,
        { agencyId: a.agencyId, userId: a.user.id },
        (scoped) => scoped.insert(companies).values(rows),
      ),
    );
    const ids: string[] = [];
    let cursor: string | null = null;
    for (const size of [50, 50, 3]) {
      const response = await request(
        "GET",
        `listCompanies${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        a.cookie,
      );
      expect(response.statusCode).toBe(200);
      const page = response.json().data;
      expect(page.items).toHaveLength(size);
      ids.push(...page.items.map((row: { id: string }) => row.id));
      cursor = page.nextCursor;
    }
    expect(cursor).toBeNull();
    expect(ids).toEqual(
      rows
        .map((row) => row.id)
        .sort()
        .reverse(),
    );
  });

  it("uses the same generic conflict for reserved and foreign duplicate slugs", async () => {
    const { a, b } = await setup();
    const foreign = await create(b);
    const duplicate = await request(
      "POST",
      "createCompany",
      a.cookie,
      input({ slug: foreign.details.slug }),
    );
    const reserved = await request(
      "POST",
      "createCompany",
      a.cookie,
      input({ slug: "api" }),
    );
    expect(duplicate.statusCode).toBe(409);
    expect(reserved.statusCode).toBe(409);
    expect(duplicate.json()).toEqual(reserved.json());
    expect(JSON.stringify(duplicate.json())).not.toContain(b.agencyId);
    expect(await stored(a)).toEqual([]);
  });

  it("rejects forged selectors, unsupported settings and malformed cursors", async () => {
    const { a, b } = await setup();
    for (const extra of [
      { agencyId: b.agencyId },
      { id: v7() },
      { status: "suspended" },
      { settings: {} },
      { defaultCountry: "US" },
      { timezone: "UTC" },
      { slug: "Bad Slug" },
    ]) {
      expect(
        (await request("POST", "createCompany", a.cookie, input(extra)))
          .statusCode,
      ).toBe(400);
    }
    for (const query of [
      `agencyId=${b.agencyId}`,
      "role=owner",
      "cursor=bad",
      "cursor=",
    ]) {
      expect(
        (await request("GET", `listCompanies?${query}`, a.cookie)).statusCode,
      ).toBe(400);
    }
    expect(await stored(a)).toEqual([]);
  });

  it("refuses owners and identities without agency staff membership", async () => {
    const { owner } = await setup();
    const ordinary = await fixture.login({ ip: "198.51.100.83" });
    for (const cookie of [owner.cookie, ordinary.cookie, undefined]) {
      const status = cookie ? 403 : 401;
      expect(
        (await request("POST", "createCompany", cookie, input())).statusCode,
      ).toBe(status);
      expect((await request("GET", "listCompanies", cookie)).statusCode).toBe(
        status,
      );
    }
  });

  it.each(["suspended", "closing", "pending"] as const)(
    "refuses an agency that becomes %s",
    async (status) => {
      const { a } = await setup();
      await fixture.db.transaction((tx) =>
        tx.update(agencies).set({ status }).where(eq(agencies.id, a.agencyId)),
      );
      expect(
        (await request("POST", "createCompany", a.cookie, input())).statusCode,
      ).toBe(403);
      expect((await request("GET", "listCompanies", a.cookie)).statusCode).toBe(
        403,
      );
    },
  );

  it.each(["membership", "user", "session"])(
    "rejects a captured actor after %s revocation commits",
    async (kind) => {
      const { a } = await setup();
      const service = companyService.create({
        createCompanyInvite: fixture.invitations.createCompanyInvite,
        context: context.create({
          db: fixture.db,
          sessions: fixture.apps[0].sessions,
        }),
        now: fixture.now,
        async seedCompany() {
          throw new Error("Unexpected company seed");
        },
      });
      const actor = await service.requireAgencyContext({
        headers: { cookie: a.cookie },
      });
      const held = await fixture.holdUser(a.user.id, async (tx) => {
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
      });
      const pending = service.createCompany(actor, input(), {
        ip: "198.51.100.1",
      });
      const assertion = expect(pending).rejects.toMatchObject({
        code: kind === "membership" ? "forbidden" : "unauthorized",
      });
      try {
        await fixture.waitForLock();
      } finally {
        held.release();
        await held.done;
      }
      await assertion;
      await expect(service.listCompanies(actor, {})).rejects.toMatchObject({
        code: kind === "membership" ? "forbidden" : "unauthorized",
      });
      expect(await stored(a)).toEqual([]);
    },
  );

  it("requires fresh OTP and same origin for creation while allowing stale OTP reads", async () => {
    const { a } = await setup();
    expect(
      (
        await request(
          "POST",
          "createCompany",
          a.cookie,
          input(),
          "https://hostile.example",
        )
      ).statusCode,
    ).toBe(403);
    fixture.advance(900001);
    const response = await request("POST", "createCompany", a.cookie, input());
    expect(response.statusCode).toBe(428);
    expect(response.json()).toMatchObject({ error: "step_up_required" });
    expect((await request("GET", "listCompanies", a.cookie)).statusCode).toBe(
      200,
    );
    expect(await stored(a)).toEqual([]);
  });

  it("rolls back the company when audit insertion fails", async () => {
    const { a } = await setup();
    await fixture.owner("REVOKE INSERT ON audit_log FROM anar_app");
    try {
      expect(
        (await request("POST", "createCompany", a.cookie, input())).statusCode,
      ).toBe(500);
      expect(await stored(a)).toEqual([]);
      expect(
        await fixture.rows(
          sql`select id from audit_log where action='company.created'`,
        ),
      ).toEqual([]);
    } finally {
      await fixture.owner("GRANT INSERT ON audit_log TO anar_app");
    }
  });

  it("never turns database errors into an empty list", async () => {
    const { a } = await setup();
    await fixture.owner("REVOKE SELECT ON companies FROM anar_app");
    try {
      expect((await request("GET", "listCompanies", a.cookie)).statusCode).toBe(
        500,
      );
    } finally {
      await fixture.owner("GRANT SELECT ON companies TO anar_app");
    }
  });

  it("enforces scope kinds and both company IDs as the runtime role", async () => {
    const { a, b } = await setup();
    const own = await create(a);
    const foreign = await create(b);
    const read = () =>
      fixture.db.transaction((tx) => tx.select().from(companies));
    expect(await read()).toEqual([]);
    expect(
      await fixture.db.transaction((tx) =>
        withPlatformIdentity(tx, a.user.id, (scoped) =>
          scoped.select().from(companies),
        ),
      ),
    ).toEqual([]);
    expect((await stored(a)).map((row) => row.id)).toEqual([own.id]);
    for (const [agencyId, companyId, expected] of [
      [a.agencyId, own.id, [own.id]],
      [a.agencyId, foreign.id, []],
      [b.agencyId, own.id, []],
    ] as const) {
      const rows = await fixture.db.transaction((tx) =>
        withPlatformTenant(
          tx,
          { agencyId, companyId, userId: a.user.id },
          (scoped) => scoped.select({ id: companies.id }).from(companies),
        ),
      );
      expect(rows.map((row) => row.id)).toEqual(expected);
    }
    expect(await read()).toEqual([]);
    await expect(
      fixture.db.transaction((tx) =>
        withPlatformAgency(
          tx,
          { agencyId: a.agencyId, userId: a.user.id },
          (scoped) =>
            scoped.insert(companies).values({
              id: v7(),
              agencyId: b.agencyId,
              ...input(),
              status: "active",
              defaultCountry: "NP",
              timezone: "Asia/Kathmandu",
            }),
        ),
      ),
    ).rejects.toThrow();
    expect(
      await fixture.db.transaction((tx) =>
        withPlatformAgency(
          tx,
          { agencyId: a.agencyId, userId: a.user.id },
          (scoped) =>
            scoped
              .update(companies)
              .set({ name: "Wrong agency" })
              .where(eq(companies.id, foreign.id))
              .returning(),
        ),
      ),
    ).toEqual([]);
  });

  it("rejects foreign audit pairs and nonexistent acting companies through foreign keys", async () => {
    const { a, b } = await setup();
    const foreign = await create(b);
    await expect(
      fixture.db.transaction((tx) =>
        tx.insert(auditLog).values({
          id: v7(),
          actorUserId: a.user.id,
          actorRole: "agency_staff",
          agencyId: a.agencyId,
          companyId: foreign.id,
          action: "company.created",
          targetType: "company",
          targetId: foreign.id,
          data: { companyId: foreign.id },
          ip: null,
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    const before = await fixture.sessionRows(a.user.id);
    await expect(
      fixture.db.transaction((tx) =>
        tx
          .update(sessions)
          .set({
            actingCompanyId: v7(),
            actingReason: "Proof missing company",
            actingUntil: new Date(fixture.now().getTime() + 3600000),
          })
          .where(eq(sessions.userId, a.user.id)),
      ),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    expect(await fixture.sessionRows(a.user.id)).toEqual(before);
  });

  it("serves creation and listing through the compiled API", async () => {
    const { a } = await setup();
    const api = await fixture.startApi();
    try {
      const response = await fetch(`${api.url}/api/companies/createCompany`, {
        method: "POST",
        headers: {
          origin: publicOrigin,
          cookie: a.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify(input()),
      });
      expect(response.status).toBe(200);
      const created = (await response.json()) as {
        data: { companyId: string };
      };
      const listed = await fetch(`${api.url}/api/companies/listCompanies`, {
        headers: { cookie: a.cookie },
      });
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({
        data: { items: [{ id: created.data.companyId }] },
      });
    } finally {
      await fixture.stopProcesses();
    }
  });
});
