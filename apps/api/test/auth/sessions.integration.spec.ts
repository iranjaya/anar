import { sessions, users } from "@anar/db/platform";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AuthFixture, startAuthFixture } from "./fixture.js";

describe("own devices on Postgres", () => {
  let fixture: AuthFixture;
  beforeAll(async () => {
    fixture = await startAuthFixture();
    expect(fixture.postgres.port).not.toBeOneOf([3000, 3001, 3100]);
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  const list = (cookie?: string, query = "") =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/auth/listSessions${query}`,
      headers: cookie ? { cookie } : {},
    });
  function cleared(header: unknown, secure = false) {
    expect(header).toBe(
      `anar_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`,
    );
  }

  it("lists only own live devices without renewing or exposing secrets", async () => {
    const first = await fixture.login();
    fixture.advance(1000);
    const second = await fixture.loginAs(first.user);
    const [old, current] = (await fixture.sessionRows(first.user.id)).sort(
      (a, b) => a.id.localeCompare(b.id),
    );
    const foreign = await fixture.login();
    const [other] = await fixture.sessionRows(foreign.user.id);
    await fixture.db.transaction(async (tx) => {
      await tx.insert(sessions).values([
        { ...old, id: v7(), tokenHash: "expired", expiresAt: fixture.now() },
        { ...old, id: v7(), tokenHash: "revoked", revokedAt: fixture.now() },
      ]);
    });
    const before = await fixture.sessionRows(first.user.id);
    fixture.advance(3600000);
    const response = await list(second.cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: [
        {
          id: current.id,
          deviceLabel: current.deviceLabel,
          lastSeenAt: current.lastSeenAt.toISOString(),
          current: true,
        },
        {
          id: old.id,
          deviceLabel: old.deviceLabel,
          lastSeenAt: old.lastSeenAt.toISOString(),
          current: false,
        },
      ],
    });
    expect(response.body).not.toContain(other.id);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(await fixture.sessionRows(first.user.id)).toEqual(before);
  });

  it("returns not_found for another person's device and a missing ID", async () => {
    const own = await fixture.login();
    const other = await fixture.login();
    const before = await fixture.sessionRows(other.user.id);
    for (const sessionId of [before[0].id, v7()]) {
      const response = await fixture.post(
        "revokeSession",
        { sessionId },
        { cookie: own.cookie },
      );
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        ok: false,
        error: "not_found",
        message: "Session not found",
      });
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    expect(await fixture.sessionRows(other.user.id)).toEqual(before);
  });

  it("revokes another own device immediately and preserves repeated revocation", async () => {
    const own = await fixture.login();
    const other = await fixture.loginAs(own.user, { index: 1 });
    const actor = await fixture.apps[1].sessions.requireSession({
      headers: { cookie: other.cookie },
    });
    const response = await fixture.post(
      "revokeSession",
      { sessionId: actor.session.id },
      { cookie: own.cookie },
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect((await list(other.cookie)).statusCode).toBe(401);
    expect(
      (await fixture.post("refresh", {}, { index: 1, cookie: other.cookie }))
        .statusCode,
    ).toBe(401);
    expect((await list(own.cookie)).statusCode).toBe(200);
    const before = await fixture.sessionRows(own.user.id);
    fixture.advance(1000);
    expect(
      (
        await fixture.post(
          "revokeSession",
          { sessionId: actor.session.id },
          { cookie: own.cookie },
        )
      ).statusCode,
    ).toBe(200);
    expect(await fixture.sessionRows(own.user.id)).toEqual(before);
  });

  it.each([false, true])(
    "clears the current cookie with Secure=%s",
    async (secure) => {
      const instance = secure
        ? await fixture.addApp({ protocol: "https" })
        : fixture.apps[0];
      const index = fixture.apps.indexOf(instance);
      const own = await fixture.login({ index });
      const [row] = await fixture.sessionRows(own.user.id);
      const response = await fixture.post(
        "revokeSession",
        { sessionId: row.id.toUpperCase() },
        { index, cookie: own.cookie },
      );
      expect(response.statusCode).toBe(200);
      cleared(response.headers["set-cookie"], secure);
      expect((await list(own.cookie)).statusCode).toBe(401);
    },
  );

  it.each(["active", "expired", "revoked", "inactive"])(
    "logs out a %s identity repeatedly",
    async (state) => {
      const own = await fixture.login();
      const other = await fixture.login();
      if (state === "expired")
        fixture.setTime(
          (await fixture.sessionRows(own.user.id))[0].expiresAt.getTime(),
        );
      if (state === "revoked")
        await fixture.db.transaction((tx) =>
          tx
            .update(sessions)
            .set({ revokedAt: fixture.now() })
            .where(eq(sessions.userId, own.user.id)),
        );
      if (state === "inactive")
        await fixture.db.transaction((tx) =>
          tx
            .update(users)
            .set({ deactivatedAt: fixture.now() })
            .where(eq(users.id, own.user.id)),
        );
      const otherBefore = await fixture.sessionRows(other.user.id);
      const response = await fixture.post("logout", {}, { cookie: own.cookie });
      expect(response.statusCode).toBe(200);
      cleared(response.headers["set-cookie"]);
      const after = await fixture.sessionRows(own.user.id);
      expect(after[0].revokedAt).not.toBeNull();
      fixture.advance(1000);
      const repeated = await fixture.post("logout", {}, { cookie: own.cookie });
      expect(repeated.statusCode).toBe(200);
      cleared(repeated.headers["set-cookie"]);
      expect(await fixture.sessionRows(own.user.id)).toEqual(after);
      expect(await fixture.sessionRows(other.user.id)).toEqual(otherBefore);
      expect((await list(own.cookie)).statusCode).toBe(401);
    },
  );

  it.each([undefined, "anar_session=wrong", `anar_session=${"A".repeat(43)}`])(
    "logs out an absent or invalid cookie %s",
    async (cookie) => {
      const own = await fixture.login();
      const before = await fixture.sessionRows(own.user.id);
      const response = await fixture.post("logout", {}, { cookie });
      expect(response.statusCode).toBe(200);
      cleared(response.headers["set-cookie"]);
      expect(await fixture.sessionRows(own.user.id)).toEqual(before);
    },
  );

  it.each([null, "null", "https://hostile.example"])(
    "rejects Origin %s before revoking or clearing",
    async (origin) => {
      const own = await fixture.login();
      const before = await fixture.sessionRows(own.user.id);
      for (const [path, body] of [
        ["logout", {}],
        ["revokeSession", { sessionId: before[0].id }],
      ] as const) {
        const response = await fixture.post(path, body, {
          cookie: own.cookie,
          origin,
        });
        expect(response.statusCode).toBe(403);
        expect(response.headers["set-cookie"]).toBeUndefined();
      }
      expect(await fixture.sessionRows(own.user.id)).toEqual(before);
    },
  );

  it("rejects malformed bodies and selector queries without changing sessions", async () => {
    const own = await fixture.login();
    const before = await fixture.sessionRows(own.user.id);
    for (const [path, body] of [
      ["logout", null],
      ["logout", { sessionId: before[0].id }],
      ["revokeSession", {}],
      ["revokeSession", { sessionId: "bad" }],
      ["revokeSession", { sessionId: before[0].id, userId: own.user.id }],
    ] as const) {
      const response = await fixture.post(path, body, { cookie: own.cookie });
      expect(response.statusCode).toBe(400);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    expect((await list(own.cookie, `?userId=${own.user.id}`)).statusCode).toBe(
      400,
    );
    expect((await list()).statusCode).toBe(401);
    expect(await fixture.sessionRows(own.user.id)).toEqual(before);
  });

  it("keeps the cookie when the database refuses revocation", async () => {
    const own = await fixture.login();
    const before = await fixture.sessionRows(own.user.id);
    await fixture.owner(`CREATE FUNCTION fail_revoke_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Proof revoke failure'; END $$;
      CREATE TRIGGER fail_revoke_fixture BEFORE UPDATE OF revoked_at ON sessions FOR EACH ROW EXECUTE FUNCTION fail_revoke_fixture()`);
    try {
      for (const [path, body] of [
        ["logout", {}],
        ["revokeSession", { sessionId: before[0].id }],
      ] as const) {
        const response = await fixture.post(path, body, { cookie: own.cookie });
        expect(response.statusCode).toBe(500);
        expect(response.headers["set-cookie"]).toBeUndefined();
      }
      expect(await fixture.sessionRows(own.user.id)).toEqual(before);
    } finally {
      await fixture.owner(
        "DROP TRIGGER fail_revoke_fixture ON sessions; DROP FUNCTION fail_revoke_fixture()",
      );
    }
  });

  it("revokes all devices inside the caller transaction and rolls back with it", async () => {
    const own = await fixture.login();
    await fixture.loginAs(own.user);
    const other = await fixture.login();
    const before = await fixture.sessionRows(own.user.id);
    const otherBefore = await fixture.sessionRows(other.user.id);
    await expect(
      fixture.db.transaction(async (tx) => {
        await fixture.apps[0].sessions.revokeAllSessions(tx, own.user.id);
        const rows = await tx
          .select()
          .from(sessions)
          .where(eq(sessions.userId, own.user.id));
        expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
        throw new Error("Rollback proof");
      }),
    ).rejects.toThrow("Rollback proof");
    expect(await fixture.sessionRows(own.user.id)).toEqual(before);
    await fixture.db.transaction((tx) =>
      fixture.apps[0].sessions.revokeAllSessions(tx, own.user.id),
    );
    expect(
      (await fixture.sessionRows(own.user.id)).every(
        (row) => row.revokedAt !== null,
      ),
    ).toBe(true);
    expect(await fixture.sessionRows(other.user.id)).toEqual(otherBefore);
    expect((await list(own.cookie)).statusCode).toBe(401);
  });

  it("refuses a stale actor after another transaction revokes it", async () => {
    const own = await fixture.login();
    const second = await fixture.loginAs(own.user);
    const actor = await fixture.apps[0].sessions.requireSession({
      headers: { cookie: own.cookie },
    });
    const target = await fixture.apps[1].sessions.requireSession({
      headers: { cookie: second.cookie },
    });
    const held = await fixture.holdUser(own.user.id, async (tx) => {
      await tx
        .update(sessions)
        .set({ revokedAt: fixture.now() })
        .where(eq(sessions.id, actor.session.id));
    });
    const pending = fixture.post(
      "revokeSession",
      { sessionId: target.session.id },
      { cookie: own.cookie },
    );
    try {
      await fixture.waitForLock();
    } finally {
      held.release();
      await held.done;
    }
    expect((await pending).statusCode).toBe(401);
    expect((await list(second.cookie)).statusCode).toBe(200);
  });

  it("never revives a session while refresh, logout and revoke race", async () => {
    const own = await fixture.login();
    const [row] = await fixture.sessionRows(own.user.id);
    fixture.advance(3600000);
    const responses = await Promise.all([
      fixture.post("refresh", {}, { cookie: own.cookie }),
      fixture.post("logout", {}, { index: 1, cookie: own.cookie }),
      fixture.post(
        "revokeSession",
        { sessionId: row.id },
        { cookie: own.cookie },
      ),
    ]);
    expect(responses[1].statusCode).toBe(200);
    expect(
      responses.every((response) => [200, 401].includes(response.statusCode)),
    ).toBe(true);
    expect(
      (await fixture.sessionRows(own.user.id))[0].revokedAt,
    ).not.toBeNull();
    expect(
      (await fixture.post("refresh", {}, { cookie: own.cookie })).statusCode,
    ).toBe(401);
  });
});
