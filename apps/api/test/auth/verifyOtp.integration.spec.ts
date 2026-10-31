import { createHash } from "node:crypto";
import { otpCodes, sessions, users } from "@anar/db/platform";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { type AuthFixture, startAuthFixture } from "./fixture.js";

describe("OTP verification on Postgres", () => {
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

  async function pendingCode() {
    const user = await fixture.seedUser();
    expect(
      (await fixture.post("requestOtp", { email: user.email })).statusCode,
    ).toBe(200);
    return { user, ...(await fixture.currentCode(user.id)) };
  }

  it.each([false, true])(
    "stores only hashes and issues a host-only cookie with HTTPS=%s",
    async (https) => {
      const index = https
        ? fixture.apps.indexOf(await fixture.addApp({ protocol: "https" }))
        : 0;
      const issued = await fixture.login({ index });
      expect(issued.response.json()).toEqual({
        ok: true,
        data: { redirectTo: "/workspaces" },
      });
      const token = issued.cookie.slice("anar_session=".length);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
      expect(issued.header).toContain("Path=/; HttpOnly; SameSite=Lax;");
      expect(issued.header.includes("; Secure")).toBe(https);
      expect(issued.header).not.toMatch(/domain=/i);
      const [stored] = await fixture.sessionRows(issued.user.id);
      expect(stored.tokenHash).toBe(
        createHash("sha256").update(token).digest("hex"),
      );
      expect(stored.tokenHash).not.toBe(token);
      expect(stored.lastOtpAt).toEqual(fixture.now());
      expect(stored.expiresAt.getTime()).toBe(
        Math.floor(fixture.now().getTime() / 1000) * 1000 + 30 * 86400000,
      );
      const expires = issued.header
        .split("; ")
        .find((part) => part.startsWith("Expires="));
      expect(expires && new Date(expires.slice(8))).toEqual(stored.expiresAt);
      expect((await fixture.challenges(issued.user.id))[0]).toMatchObject({
        consumedAt: fixture.now(),
        attempts: 0,
      });
      expect(issued.challenge.codeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(issued.challenge.codeHash).not.toBe(issued.code);
      const current = await fixture.apps[index].sessions.requireSession({
        headers: { cookie: issued.cookie },
      });
      expect(Object.keys(current.session).sort()).toEqual(
        [
          "id",
          "userId",
          "lastSeenAt",
          "expiresAt",
          "revokedAt",
          "lastOtpAt",
          "actingCompanyId",
          "actingReason",
          "actingUntil",
          "actingActive",
        ].sort(),
      );
      expect(JSON.stringify(current)).not.toContain(token);
    },
  );

  it("commits five wrong attempts and refuses the sixth or a later correct code", async () => {
    const issued = await pendingCode();
    const wrong = String((Number(issued.code) + 1) % 1000000).padStart(6, "0");
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(
        (
          await fixture.post("verifyOtp", {
            email: issued.user.email,
            code: wrong,
          })
        ).statusCode,
      ).toBe(401);
      const [stored] = await fixture.challenges(issued.user.id);
      expect(stored.attempts).toBe(attempt);
      expect(stored.consumedAt).toEqual(attempt === 5 ? fixture.now() : null);
    }
    for (const code of [wrong, issued.code])
      expect(
        (await fixture.post("verifyOtp", { email: issued.user.email, code }))
          .statusCode,
      ).toBe(401);
    expect((await fixture.challenges(issued.user.id))[0].attempts).toBe(5);
    expect(await fixture.sessionRows(issued.user.id)).toEqual([]);
  });

  it("caps parallel wrong attempts at five across two API pools", async () => {
    const issued = await pendingCode();
    const wrong = String((Number(issued.code) + 1) % 1000000).padStart(6, "0");
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        fixture.post(
          "verifyOtp",
          { email: issued.user.email, code: wrong },
          { index: index % 2 },
        ),
      ),
    );
    expect(results.every((response) => response.statusCode === 401)).toBe(true);
    expect((await fixture.challenges(issued.user.id))[0]).toMatchObject({
      attempts: 5,
      consumedAt: fixture.now(),
    });
    expect(
      (
        await fixture.post("verifyOtp", {
          email: issued.user.email,
          code: issued.code,
        })
      ).statusCode,
    ).toBe(401);
    expect(await fixture.sessionRows(issued.user.id)).toEqual([]);
  });

  it("creates exactly one session across concurrent correct submissions", async () => {
    const issued = await pendingCode();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        fixture.post(
          "verifyOtp",
          { email: issued.user.email, code: issued.code },
          { index: index % 2 },
        ),
      ),
    );
    expect(
      results.filter((response) => response.statusCode === 200),
    ).toHaveLength(1);
    expect(
      results.filter((response) => response.statusCode === 401),
    ).toHaveLength(9);
    expect(await fixture.sessionRows(issued.user.id)).toHaveLength(1);
    for (const result of results.filter(
      (response) => response.statusCode === 401,
    ))
      expect(result.headers["set-cookie"]).toBeUndefined();
  });

  it.each([-1, 0, 1])("checks expiry at a %s ms offset", async (offset) => {
    const issued = await pendingCode();
    fixture.setTime(issued.challenge.expiresAt.getTime() + offset);
    const response = await fixture.post("verifyOtp", {
      email: issued.user.email,
      code: issued.code,
    });
    expect(response.statusCode).toBe(offset < 0 ? 200 : 401);
    expect(await fixture.sessionRows(issued.user.id)).toHaveLength(
      offset < 0 ? 1 : 0,
    );
    expect((await fixture.challenges(issued.user.id))[0].attempts).toBe(0);
  });

  it("rejects replay after a successful login", async () => {
    const issued = await fixture.login();
    const replay = await fixture.post("verifyOtp", {
      email: issued.user.email,
      code: issued.code,
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.headers["set-cookie"]).toBeUndefined();
    expect(await fixture.sessionRows(issued.user.id)).toHaveLength(1);
  });

  it("refuses a replaced code and accepts the latest code", async () => {
    const first = await pendingCode();
    expect(
      (await fixture.post("requestOtp", { email: first.user.email }))
        .statusCode,
    ).toBe(200);
    let latest = await fixture.currentCode(first.user.id);
    if (latest.code === first.code) {
      expect(
        (await fixture.post("requestOtp", { email: first.user.email }))
          .statusCode,
      ).toBe(200);
      latest = await fixture.currentCode(first.user.id);
    }
    expect(latest.code).not.toBe(first.code);
    const previous = (await fixture.challenges(first.user.id)).find(
      (row) => row.id === first.challenge.id,
    );
    expect(previous?.consumedAt).toEqual(fixture.now());
    expect(
      (
        await fixture.post("verifyOtp", {
          email: first.user.email,
          code: first.code,
        })
      ).statusCode,
    ).toBe(401);
    expect(await fixture.sessionRows(first.user.id)).toEqual([]);
    expect(
      (
        await fixture.post("verifyOtp", {
          email: first.user.email,
          code: latest.code,
        })
      ).statusCode,
    ).toBe(200);
    expect(await fixture.sessionRows(first.user.id)).toHaveLength(1);
  });

  it("refuses a session-bound step-up challenge in the login endpoint", async () => {
    const issued = await fixture.login();
    await fixture.post("requestOtp", { email: issued.user.email });
    const next = await fixture.currentCode(issued.user.id);
    const [session] = await fixture.sessionRows(issued.user.id);
    await fixture.db.transaction((tx) =>
      tx
        .update(otpCodes)
        .set({ purpose: "step_up", sessionId: session.id })
        .where(eq(otpCodes.id, next.challenge.id)),
    );
    expect(
      (
        await fixture.post("verifyOtp", {
          email: issued.user.email,
          code: next.code,
        })
      ).statusCode,
    ).toBe(401);
    const stored = (await fixture.challenges(issued.user.id)).find(
      (row) => row.id === next.challenge.id,
    );
    expect(stored).toMatchObject({ attempts: 0, consumedAt: null });
    expect(await fixture.sessionRows(issued.user.id)).toHaveLength(1);
  });

  it("rejects a user deactivated after requesting a code", async () => {
    const issued = await pendingCode();
    await fixture.db.transaction((tx) =>
      tx
        .update(users)
        .set({ deactivatedAt: fixture.now() })
        .where(eq(users.id, issued.user.id)),
    );
    expect(
      (
        await fixture.post("verifyOtp", {
          email: issued.user.email,
          code: issued.code,
        })
      ).statusCode,
    ).toBe(401);
    expect(await fixture.sessionRows(issued.user.id)).toEqual([]);
  });

  it("rolls challenge consumption back when session insertion fails", async () => {
    const issued = await pendingCode();
    await fixture.owner("REVOKE INSERT ON public.sessions FROM anar_app");
    try {
      const response = await fixture.post("verifyOtp", {
        email: issued.user.email,
        code: issued.code,
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        ok: false,
        error: "unavailable",
      });
      expect((await fixture.challenges(issued.user.id))[0]).toMatchObject({
        consumedAt: null,
        attempts: 0,
      });
      expect(await fixture.sessionRows(issued.user.id)).toEqual([]);
    } finally {
      await fixture.owner("GRANT INSERT ON public.sessions TO anar_app");
    }
    expect(
      (
        await fixture.post("verifyOtp", {
          email: issued.user.email,
          code: issued.code,
        })
      ).statusCode,
    ).toBe(200);
  });

  it("rejects invalid Origin or forged identity without consuming a valid code", async () => {
    const issued = await pendingCode();
    for (const origin of [null, "null", "https://hostile.example"]) {
      expect(
        (
          await fixture.post(
            "verifyOtp",
            { email: issued.user.email, code: issued.code },
            { origin },
          )
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await fixture.post("verifyOtp", {
          email: issued.user.email,
          code: issued.code,
          userId: issued.user.id,
        })
      ).statusCode,
    ).toBe(400);
    expect((await fixture.challenges(issued.user.id))[0]).toMatchObject({
      consumedAt: null,
      attempts: 0,
    });
    expect(await fixture.sessionRows(issued.user.id)).toEqual([]);
  });

  it.each(["revoked", "expired", "deactivated"])(
    "rejects a %s session on its next read",
    async (state) => {
      const issued = await fixture.login();
      const [session] = await fixture.sessionRows(issued.user.id);
      if (state === "expired") fixture.setTime(session.expiresAt.getTime());
      else
        await fixture.db.transaction((tx) =>
          state === "revoked"
            ? tx
                .update(sessions)
                .set({ revokedAt: fixture.now() })
                .where(eq(sessions.id, session.id))
            : tx
                .update(users)
                .set({ deactivatedAt: fixture.now() })
                .where(eq(users.id, issued.user.id)),
        );
      await expect(
        fixture.apps[0].sessions.requireSession({
          headers: { cookie: issued.cookie },
        }),
      ).rejects.toMatchObject({ code: "unauthorized" });
    },
  );

  it.each(["revoked", "deactivated"])(
    "rejects queued platform work after %s commits",
    async (state) => {
      const issued = await fixture.login();
      const actor = await fixture.apps[0].sessions.requireSession({
        headers: { cookie: issued.cookie },
      });
      const held = await fixture.holdUser(issued.user.id, async (tx) => {
        if (state === "revoked")
          await tx
            .update(sessions)
            .set({ revokedAt: fixture.now() })
            .where(eq(sessions.id, actor.session.id));
        else
          await tx
            .update(users)
            .set({ deactivatedAt: fixture.now() })
            .where(eq(users.id, issued.user.id));
      });
      const callback = vi.fn(async () => true);
      const result = fixture.apps[0].sessions
        .withPlatformSession(actor, callback)
        .catch((error: unknown) => error);
      try {
        await fixture.waitForLock();
      } finally {
        held.release();
        await held.done;
      }
      expect(await result).toMatchObject({ code: "unauthorized" });
      expect(callback).not.toHaveBeenCalled();
    },
  );

  it("passes fresh role and OTP state to locked platform work", async () => {
    const issued = await fixture.login({ owner: true });
    const actor = await fixture.apps[0].sessions.requireSession({
      headers: { cookie: issued.cookie },
    });
    const older = new Date(fixture.now().getTime() - 3600000);
    const held = await fixture.holdUser(issued.user.id, async (tx) => {
      await tx
        .update(users)
        .set({ platformRole: null })
        .where(eq(users.id, issued.user.id));
      await tx
        .update(sessions)
        .set({ lastOtpAt: older })
        .where(eq(sessions.id, actor.session.id));
    });
    const result = fixture.apps[0].sessions.withPlatformSession(
      actor,
      async (_tx, current) => current,
    );
    try {
      await fixture.waitForLock();
    } finally {
      held.release();
      await held.done;
    }
    expect(await result).toMatchObject({
      user: { platformRole: null },
      session: { lastOtpAt: older },
    });
    expect(actor.user.platformRole).toBe("owner");
  });

  it("rolls back failed platform work", async () => {
    const issued = await fixture.login();
    const actor = await fixture.apps[0].sessions.requireSession({
      headers: { cookie: issued.cookie },
    });
    await expect(
      fixture.apps[0].sessions.withPlatformSession(actor, async (tx) => {
        await tx
          .update(users)
          .set({ name: "Rolled back" })
          .where(eq(users.id, issued.user.id));
        throw new Error("Rollback platform fixture");
      }),
    ).rejects.toThrow("Rollback platform fixture");
    expect(
      (
        await fixture.apps[0].sessions.requireSession({
          headers: { cookie: issued.cookie },
        })
      ).user.name,
    ).toBe("Proof user");
  });
});
