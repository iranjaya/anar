import {
  agencies,
  agencyMembers,
  companies,
  sessions,
  users,
  withPlatformAgency,
  withPlatformIdentity,
  withPlatformTenant,
} from "@anar/db/platform";
import { companyMembers } from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import agencyService from "../../src/modules/agencies/service.js";
import companyService from "../../src/modules/companies/service.js";
import memberService from "../../src/modules/members/service.js";
import tenant from "../../src/modules/tenant/index.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

describe("session discovery and company context", () => {
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
  const get = (
    path: string,
    cookie?: string,
    headers: Record<string, string> = {},
  ) =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/${path}`,
      headers: { ...headers, ...(cookie ? { cookie } : {}) },
    });
  async function setup(role: "super_admin" | "admin" = "super_admin") {
    const base = await fixture.setup();
    const a2 = await fixture.createCompany(base.a.cookie);
    const b2 = await fixture.createCompany(base.b.cookie);
    const user = await fixture.seedUser();
    const member = await fixture.seedMember(base.a, user.id, "active", role);
    const login = await fixture.loginAs(user, { ip: "198.51.100.93" });
    return { ...base, a2, b2, user, member, login };
  }

  it("routes owner, staff, one company, multiple companies and no-access identities", async () => {
    const { owner, a, b, login, user } = await setup();
    const empty = await fixture.login({ ip: "198.51.100.94" });
    for (const [cookie, kind, redirectTo] of [
      [owner.cookie, "owner", "/owner/agencies"],
      [a.cookie, "agency", "/agency/companies"],
      [login.cookie, "company", `/${a.company.slug}`],
      [empty.cookie, "none", "/account"],
    ]) {
      const response = await get("auth/getSession", cookie);
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({
        workspace: { kind },
        redirectTo,
      });
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(Object.keys(response.json().data).sort()).toEqual([
        "redirectTo",
        "session",
        "user",
        "workspace",
      ]);
    }
    await fixture.seedMember(b, user.id);
    expect(
      (await get("auth/getSession", login.cookie)).json().data,
    ).toMatchObject({
      workspace: { kind: "company" },
      redirectTo: "/workspaces",
    });
    const page = (await get("auth/listWorkspaces", login.cookie)).json().data;
    expect(page.items.map((row: { id: string }) => row.id).sort()).toEqual(
      [a.companyId, b.companyId].sort(),
    );
    expect(page.nextCursor).toBeNull();
  });

  it.each(["super_admin", "admin"] as const)(
    "resolves %s by slug with exact public fields and dates",
    async (role) => {
      const { a, user, member, login } = await setup(role);
      expect(a.companyId).not.toBe(a.company.slug);
      const response = await get(
        `context?company=${a.company.slug}`,
        login.cookie,
      );
      expect(response.statusCode).toBe(200);
      const [session] = await fixture.sessionRows(user.id);
      const agencyResponse = await fixture.request(
        "GET",
        "getAgency",
        a.cookie,
      );
      expect(response.json()).toEqual({
        ok: true,
        data: {
          agencyId: a.agencyId,
          agency: agencyResponse.json().data.agency,
          companyId: a.companyId,
          company: { ...a.company, agencyId: a.agencyId, status: "active" },
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            platformRole: null,
          },
          member: {
            id: member.id,
            companyId: a.companyId,
            userId: user.id,
            name: member.name,
            role,
            status: "active",
          },
          role,
          session: {
            id: session.id,
            actingCompanyId: null,
            actingReason: null,
            actingUntil: null,
          },
          capabilities:
            role === "admin"
              ? [
                  "leads.view",
                  "leads.update",
                  "followups.log",
                  "reports.view_own",
                  "sessions.manage_own",
                ]
              : expect.arrayContaining([
                  "members.invite_admin",
                  "leads.assign",
                ]),
          resourceAccess: role === "admin" ? "own" : "all",
        },
      });
      const view = (await get("auth/getSession", login.cookie)).json().data;
      expect(view.user).toEqual({
        id: user.id,
        name: user.name,
        email: user.email,
        platformRole: null,
      });
      expect(view.session).toEqual({
        id: session.id,
        expiresAt: session.expiresAt.toISOString(),
        lastOtpAt: session.lastOtpAt.toISOString(),
        actingCompanyId: null,
        actingReason: null,
        actingUntil: null,
      });
      expect(
        (await get(`context?company=${a.companyId}`, login.cookie)).statusCode,
      ).toBe(404);
      expect(JSON.stringify([response.json(), view])).not.toContain(
        session.tokenHash,
      );
    },
  );

  it("refuses owner before company reads and staff before entry, including an expired acting triplet", async () => {
    const { owner, a, b } = await setup();
    await fixture.owner("REVOKE SELECT ON companies FROM anar_app");
    try {
      expect(
        (await get(`context?company=${a.company.slug}`, owner.cookie))
          .statusCode,
      ).toBe(403);
      expect((await get("auth/getSession", owner.cookie)).statusCode).toBe(200);
      expect((await get("auth/getSession", a.cookie)).statusCode).toBe(200);
    } finally {
      await fixture.owner("GRANT SELECT ON companies TO anar_app");
    }
    await fixture.db.transaction((tx) =>
      tx
        .update(sessions)
        .set({
          actingCompanyId: a.companyId,
          actingReason: "Expired old entry",
          actingUntil: new Date(fixture.now().getTime() - 1000),
        })
        .where(eq(sessions.userId, a.user.id)),
    );
    expect(
      (await get(`context?company=${a.company.slug}`, a.cookie)).statusCode,
    ).toBe(403);
    expect(
      (await get(`context?company=${b.company.slug}`, a.cookie)).statusCode,
    ).toBe(404);
    expect((await get("auth/listWorkspaces", a.cookie)).statusCode).toBe(403);
    expect((await get("auth/listWorkspaces", owner.cookie)).statusCode).toBe(
      403,
    );
  });

  it.each(["staff", "agency"])(
    "routes inactive %s to no access",
    async (kind) => {
      const { a } = await setup();
      await fixture.db.transaction(async (tx) => {
        if (kind === "agency")
          await tx
            .update(agencies)
            .set({ status: "suspended" })
            .where(eq(agencies.id, a.agencyId));
        else
          await withPlatformAgency(
            tx,
            { agencyId: a.agencyId, userId: a.user.id },
            (scoped) =>
              scoped
                .update(agencyMembers)
                .set({ status: "deactivated" })
                .where(eq(agencyMembers.userId, a.user.id)),
          );
      });
      expect(
        (await get("auth/getSession", a.cookie)).json().data,
      ).toMatchObject({ workspace: { kind: "none" }, redirectTo: "/account" });
      expect(
        (await get(`context?company=${a.company.slug}`, a.cookie)).statusCode,
      ).toBe(403);
    },
  );

  it.each(["member", "company", "agency"])(
    "hides company discovery and context after %s becomes inactive",
    async (kind) => {
      const { a, user, member, login } = await setup();
      await fixture.db.transaction(async (tx) => {
        if (kind === "agency")
          await tx
            .update(agencies)
            .set({ status: "suspended" })
            .where(eq(agencies.id, a.agencyId));
        await withPlatformTenant(
          tx,
          { agencyId: a.agencyId, companyId: a.companyId, userId: user.id },
          async (scoped) => {
            if (kind === "company")
              await scoped
                .update(companies)
                .set({ status: "closing" })
                .where(eq(companies.id, a.companyId));
            if (kind === "member")
              await scoped
                .update(companyMembers)
                .set({ status: "deactivated" })
                .where(eq(companyMembers.id, member.id));
          },
        );
      });
      expect(
        (await get(`context?company=${a.company.slug}`, login.cookie))
          .statusCode,
      ).toBe(404);
      expect((await get("auth/listWorkspaces", login.cookie)).json()).toEqual({
        ok: true,
        data: { items: [], nextCursor: null },
      });
      expect(
        (await get("auth/getSession", login.cookie)).json().data,
      ).toMatchObject({ workspace: { kind: "none" }, redirectTo: "/account" });
    },
  );

  it("rejects forged selectors and never grants another company through headers", async () => {
    const { a, a2, b, b2, login } = await setup();
    const forged = {
      "x-user-id": b.user.id,
      "x-agency-id": b.agencyId,
      "x-company-id": b.companyId,
      "x-role": "owner",
      cookie: "anar_demo=dna",
    };
    for (const slug of [a2.slug, b.company.slug, b2.slug])
      expect(
        (await get(`context?company=${slug}`, login.cookie, forged)).statusCode,
      ).toBe(404);
    for (const query of [
      `company=${a.company.slug}&agencyId=${b.agencyId}`,
      `company=${a.company.slug}&role=super_admin`,
      "company=../owner",
    ])
      expect((await get(`context?${query}`, login.cookie)).statusCode).toBe(
        400,
      );
    for (const path of [
      "auth/getSession?userId=forged",
      "auth/listWorkspaces?agencyId=forged",
      "auth/listWorkspaces?cursor=bad",
    ])
      expect((await get(path, login.cookie)).statusCode).toBe(400);
    expect(
      (await get(`context?company=${a.company.slug}`, undefined, forged))
        .statusCode,
    ).toBe(401);
  });

  it("paginates 103 own workspaces across agencies at equal timestamps without foreign rows", async () => {
    const { a, b } = await fixture.setup();
    const user = await fixture.seedUser();
    const rows = Array.from({ length: 103 }, (_, i) => ({
      id: v7(),
      agencyId: i % 2 ? a.agencyId : b.agencyId,
      name: `Workspace ${i}`,
      slug: `workspace-${v7()}`,
      status: "active" as const,
      defaultCountry: "NP" as const,
      timezone: "Asia/Kathmandu" as const,
      createdAt: fixture.now(),
      updatedAt: fixture.now(),
    }));
    await fixture.db.transaction(async (tx) => {
      for (const row of rows) {
        await withPlatformAgency(
          tx,
          { agencyId: row.agencyId, userId: a.user.id },
          (scoped) => scoped.insert(companies).values(row),
        );
        await withPlatformTenant(
          tx,
          { agencyId: row.agencyId, companyId: row.id, userId: user.id },
          (scoped) =>
            scoped.insert(companyMembers).values({
              id: v7(),
              agencyId: row.agencyId,
              companyId: row.id,
              userId: user.id,
              name: user.name,
              role: "admin",
              status: "active",
            }),
        );
      }
    });
    const login = await fixture.loginAs(user, { ip: "198.51.100.93" });
    let cursor: string | null = null;
    const ids: string[] = [];
    for (const size of [50, 50, 3]) {
      const response = await get(
        `auth/listWorkspaces${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        login.cookie,
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

  it.each(["member", "session", "user", "company", "agency", "expiry"])(
    "rejects a stale context before its callback after queued %s revocation",
    async (kind) => {
      const { a, user, member, login } = await setup();
      const service = fixture.apps[0].tenant;
      const actor = await service.requireContext(
        { headers: { cookie: login.cookie } },
        a.company.slug,
      );
      const held = await fixture.holdUser(user.id, async (tx) => {
        if (kind === "user")
          await tx
            .update(users)
            .set({ deactivatedAt: fixture.now() })
            .where(eq(users.id, user.id));
        if (kind === "session")
          await tx
            .update(sessions)
            .set({ revokedAt: fixture.now() })
            .where(eq(sessions.id, actor.session.id));
        if (kind === "agency")
          await tx
            .update(agencies)
            .set({ status: "suspended" })
            .where(eq(agencies.id, a.agencyId));
        await withPlatformTenant(
          tx,
          { agencyId: a.agencyId, companyId: a.companyId, userId: user.id },
          async (scoped) => {
            if (kind === "member")
              await scoped
                .update(companyMembers)
                .set({ status: "deactivated" })
                .where(eq(companyMembers.id, member.id));
            if (kind === "company")
              await scoped
                .update(companies)
                .set({ status: "suspended" })
                .where(eq(companies.id, a.companyId));
          },
        );
      });
      let entered = false;
      const assertion = expect(
        service.withContext(actor, async (tx) => {
          entered = true;
          await tx
            .update(companyMembers)
            .set({ name: "Must not write" })
            .where(eq(companyMembers.id, member.id));
        }),
      ).rejects.toMatchObject({
        code: ["user", "session", "expiry"].includes(kind)
          ? "unauthorized"
          : "not_found",
      });
      try {
        await fixture.waitForLock();
        if (kind === "expiry")
          fixture.setTime(actor.session.expiresAt.getTime());
      } finally {
        held.release();
        await held.done;
      }
      await assertion;
      expect(entered).toBe(false);
      expect(
        await fixture.db.transaction((tx) =>
          withPlatformTenant(
            tx,
            { agencyId: a.agencyId, companyId: a.companyId, userId: user.id },
            (scoped) =>
              scoped
                .select({ name: companyMembers.name })
                .from(companyMembers)
                .where(eq(companyMembers.id, member.id)),
          ),
        ),
      ).toEqual([{ name: member.name }]);
    },
  );

  it("uses fresh role and the same scoped transaction through membership lookup and callback rollback", async () => {
    const { a, user, member, login } = await setup("admin");
    const observed: {
      tx?: Parameters<typeof memberService.readActiveForUser>[0];
      kind?: string;
    } = {};
    const service = tenant.create({
      db: fixture.db,
      sessions: fixture.apps[0].sessions,
      readStaffMembership: agencyService.readStaffMembership,
      readActiveAgency: agencyService.readActiveAgency,
      readAgencyCompanyBySlug: companyService.readAgencyCompanyBySlug,
      discoverWorkspaces: async (tx, userId, options) => {
        const state = await tx.execute(
          sql`select current_setting('app.scope_kind') as kind, current_setting('app.user_id') as usr`,
        );
        expect(state.rows).toEqual([{ kind: "identity", usr: user.id }]);
        expect(options.limit).toBeLessThanOrEqual(51);
        return companyService.discoverWorkspaces(tx, userId, options);
      },
      lockActiveCompany: companyService.lockActiveCompany,
      readActiveMember: async (tx, companyId, userId, lock) => {
        observed.tx = tx;
        const state = await tx.execute(
          sql`select current_setting('app.scope_kind') as kind`,
        );
        observed.kind = String(state.rows[0].kind);
        return memberService.readActiveForUser(tx, companyId, userId, lock);
      },
    });
    const actor = await service.requireContext(
      { headers: { cookie: login.cookie } },
      a.company.slug,
    );
    await fixture.db.transaction((tx) =>
      withPlatformTenant(
        tx,
        { agencyId: a.agencyId, companyId: a.companyId, userId: user.id },
        (scoped) =>
          scoped
            .update(companyMembers)
            .set({ role: "super_admin" })
            .where(eq(companyMembers.id, member.id)),
      ),
    );
    await expect(
      service.withContext(actor, async (tx, current) => {
        expect(tx).toBe(observed.tx);
        expect(observed.kind).toBe("company");
        expect(current.role).toBe("super_admin");
        expect(
          (
            await tx.execute(
              sql`select current_setting('app.agency_id') as agency, current_setting('app.company_id') as company, current_setting('app.user_id') as usr`,
            )
          ).rows,
        ).toEqual([{ agency: a.agencyId, company: a.companyId, usr: user.id }]);
        await tx
          .update(companyMembers)
          .set({ name: "Rolled back" })
          .where(eq(companyMembers.id, member.id));
        throw new Error("Rollback proof");
      }),
    ).rejects.toThrow("Rollback proof");
    expect(
      await fixture.db.transaction((tx) =>
        withPlatformTenant(
          tx,
          { agencyId: a.agencyId, companyId: a.companyId, userId: user.id },
          (scoped) =>
            scoped
              .select({ name: companyMembers.name })
              .from(companyMembers)
              .where(eq(companyMembers.id, member.id)),
        ),
      ),
    ).toEqual([{ name: member.name }]);
    expect(
      await fixture.db.transaction((tx) => tx.select().from(companies)),
    ).toEqual([]);
    expect(
      await fixture.db.transaction((tx) =>
        withPlatformIdentity(tx, user.id, (scoped) =>
          scoped.select({ id: companies.id }).from(companies),
        ),
      ),
    ).toEqual([{ id: a.companyId }]);
  });

  it("propagates discovery errors and serves the routes through the compiled API", async () => {
    const { a, login } = await setup();
    await fixture.owner("REVOKE SELECT ON company_members FROM anar_app");
    try {
      expect((await get("auth/getSession", login.cookie)).statusCode).toBe(500);
      expect((await get("auth/listWorkspaces", login.cookie)).statusCode).toBe(
        500,
      );
      expect(
        (await get(`context?company=${a.company.slug}`, login.cookie))
          .statusCode,
      ).toBe(500);
    } finally {
      await fixture.owner("GRANT SELECT ON company_members TO anar_app");
    }
    const api = await fixture.startApi();
    try {
      for (const path of [
        "auth/getSession",
        "auth/listWorkspaces",
        `context?company=${a.company.slug}`,
      ]) {
        const response = await fetch(`${api.url}/api/${path}`, {
          headers: { cookie: login.cookie },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(((await response.json()) as { ok: boolean }).ok).toBe(true);
      }
    } finally {
      await fixture.stopProcesses();
    }
  });
});
