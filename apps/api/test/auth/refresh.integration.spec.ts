import { sessions, users } from "@anar/db/platform";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AuthFixture, startAuthFixture } from "./fixture.js";

describe("session refresh on Postgres", () => {
  let fixture: AuthFixture;
  beforeAll(async () => {
    fixture = await startAuthFixture();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  it.each([0, 3599999])(
    "keeps the stored expiry before an hour at %s ms",
    async (elapsed) => {
      const issued = await fixture.login();
      const before = await fixture.sessionRows(issued.user.id);
      fixture.advance(elapsed);
      const response = await fixture.post(
        "refresh",
        {},
        { cookie: issued.cookie },
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, data: { ok: true } });
      expect(response.headers["set-cookie"]).toBe(issued.header);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(await fixture.sessionRows(issued.user.id)).toEqual(before);
    },
  );

  it.each([3600000, 3600001])(
    "renews at %s ms without extending OTP or acting access",
    async (elapsed) => {
      const issued = await fixture.login();
      const actingUntil = new Date(fixture.now().getTime() + 8 * 3600000);
      await fixture.db.transaction((tx) =>
        tx
          .update(sessions)
          .set({
            actingCompanyId: v7(),
            actingReason: "Proof support entry",
            actingUntil,
          })
          .where(eq(sessions.userId, issued.user.id)),
      );
      const [before] = await fixture.sessionRows(issued.user.id);
      fixture.advance(elapsed);
      const response = await fixture.post(
        "refresh",
        {},
        { cookie: issued.cookie },
      );
      expect(response.statusCode).toBe(200);
      const [after] = await fixture.sessionRows(issued.user.id);
      const expiresAt = new Date(
        Math.floor(fixture.now().getTime() / 1000) * 1000 + 30 * 86400000,
      );
      expect(after).toEqual({
        ...before,
        lastSeenAt: fixture.now(),
        expiresAt,
      });
      expect(response.headers["set-cookie"]).toBe(
        `${issued.cookie}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}`,
      );
    },
  );

  it.each([0, 60000])(
    "refuses expiry plus %s ms without reviving the row",
    async (elapsed) => {
      const issued = await fixture.login();
      const [before] = await fixture.sessionRows(issued.user.id);
      fixture.setTime(before.expiresAt.getTime() + elapsed);
      const response = await fixture.post(
        "refresh",
        {},
        { cookie: issued.cookie },
      );
      expect(response.statusCode).toBe(401);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await fixture.sessionRows(issued.user.id)).toEqual([before]);
    },
  );

  it("writes once across concurrent refreshes and reuses that expiry within the next hour", async () => {
    const issued = await fixture.login();
    const [before] = await fixture.sessionRows(issued.user.id);
    await fixture.owner(`CREATE TABLE refresh_write_fixture (session_id uuid PRIMARY KEY, writes integer NOT NULL);
      CREATE FUNCTION count_refresh_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO refresh_write_fixture VALUES (NEW.id, 1)
        ON CONFLICT (session_id) DO UPDATE SET writes = refresh_write_fixture.writes + 1;
        RETURN NEW;
      END $$;
      CREATE TRIGGER count_refresh_fixture AFTER UPDATE OF last_seen_at, expires_at ON public.sessions
      FOR EACH ROW EXECUTE FUNCTION count_refresh_fixture()`);
    try {
      fixture.advance(3600000);
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          fixture.post(
            "refresh",
            {},
            { index: index % 2, cookie: issued.cookie },
          ),
        ),
      );
      expect(results.every((response) => response.statusCode === 200)).toBe(
        true,
      );
      expect(
        new Set(results.map((response) => response.headers["set-cookie"])).size,
      ).toBe(1);
      const [after] = await fixture.sessionRows(issued.user.id);
      expect(after.tokenHash).toBe(before.tokenHash);
      expect(after.lastOtpAt).toEqual(before.lastOtpAt);
      expect(after.lastSeenAt).toEqual(fixture.now());
      fixture.advance(60000);
      const repeated = await fixture.post(
        "refresh",
        {},
        { cookie: issued.cookie },
      );
      expect(repeated.headers["set-cookie"]).toBe(
        results[0].headers["set-cookie"],
      );
      expect(await fixture.sessionRows(issued.user.id)).toEqual([after]);
      expect(
        await fixture.rows(
          sql`select session_id, writes from refresh_write_fixture`,
        ),
      ).toEqual([{ session_id: after.id, writes: 1 }]);
    } finally {
      await fixture.owner(
        "DROP TRIGGER count_refresh_fixture ON public.sessions; DROP FUNCTION count_refresh_fixture(); DROP TABLE refresh_write_fixture",
      );
    }
  });

  it.each(["revoked", "deactivated"])(
    "refuses refresh after queued %s commits",
    async (state) => {
      const issued = await fixture.login();
      const [before] = await fixture.sessionRows(issued.user.id);
      fixture.advance(3600000);
      const held = await fixture.holdUser(issued.user.id, async (tx) => {
        if (state === "revoked")
          await tx
            .update(sessions)
            .set({ revokedAt: fixture.now() })
            .where(eq(sessions.id, before.id));
        else
          await tx
            .update(users)
            .set({ deactivatedAt: fixture.now() })
            .where(eq(users.id, issued.user.id));
      });
      const pending = fixture.post("refresh", {}, { cookie: issued.cookie });
      try {
        await fixture.waitForLock();
      } finally {
        held.release();
        await held.done;
      }
      const response = await pending;
      expect(response.statusCode).toBe(401);
      expect(response.headers["set-cookie"]).toBeUndefined();
      const [after] = await fixture.sessionRows(issued.user.id);
      expect(after.lastSeenAt).toEqual(before.lastSeenAt);
      expect(after.expiresAt).toEqual(before.expiresAt);
    },
  );

  it("rejects a session that expires while refresh waits for its lock", async () => {
    const issued = await fixture.login();
    const [before] = await fixture.sessionRows(issued.user.id);
    const held = await fixture.holdUser(issued.user.id, async () => {});
    const pending = fixture.post("refresh", {}, { cookie: issued.cookie });
    try {
      await fixture.waitForLock();
      fixture.setTime(before.expiresAt.getTime());
    } finally {
      held.release();
      await held.done;
    }
    expect((await pending).statusCode).toBe(401);
    expect(await fixture.sessionRows(issued.user.id)).toEqual([before]);
  });

  it("keeps session reads from renewing dates or returning a cookie", async () => {
    const issued = await fixture.login();
    const before = await fixture.sessionRows(issued.user.id);
    fixture.advance(2 * 3600000);
    const view = await fixture.apps[0].sessions.requireSession({
      headers: { cookie: issued.cookie },
    });
    expect(view.session.expiresAt).toEqual(before[0].expiresAt);
    expect(view).not.toHaveProperty("cookie");
    expect(await fixture.sessionRows(issued.user.id)).toEqual(before);
  });

  it("rejects hostile Origin and nonempty bodies before renewing", async () => {
    const issued = await fixture.login();
    const before = await fixture.sessionRows(issued.user.id);
    fixture.advance(3600000);
    for (const origin of [null, "null", "https://hostile.example"]) {
      const response = await fixture.post(
        "refresh",
        {},
        { cookie: issued.cookie, origin },
      );
      expect(response.statusCode).toBe(403);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    for (const payload of [
      null,
      [],
      { userId: issued.user.id },
      { expiresAt: "2099-01-01" },
    ]) {
      const response = await fixture.post("refresh", payload, {
        cookie: issued.cookie,
      });
      expect(response.statusCode).toBe(400);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    expect(await fixture.sessionRows(issued.user.id)).toEqual(before);
  });

  it("rejects missing, malformed and unknown session cookies", async () => {
    const issued = await fixture.login();
    const before = await fixture.sessionRows(issued.user.id);
    fixture.advance(3600000);
    for (const cookie of [
      undefined,
      "anar_demo=dna",
      "anar_session=wrong",
      `anar_session=${"A".repeat(43)}`,
      "anar_session=%20",
    ]) {
      const response = await fixture.post("refresh", {}, { cookie });
      expect(response.statusCode).toBe(401);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    expect(await fixture.sessionRows(issued.user.id)).toEqual(before);
  });
});
