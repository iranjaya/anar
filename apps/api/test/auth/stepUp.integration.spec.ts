import { sessions, users } from "@anar/db/platform";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AuthFixture, startAuthFixture } from "./fixture.js";

describe("session-bound step-up on Postgres", () => {
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

  async function request(cookie: string, index = 0) {
    const response = await fixture.post("requestStepUp", {}, { cookie, index });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: { ok: true } });
    expect(response.headers["set-cookie"]).toBeUndefined();
    return response;
  }
  async function pending() {
    const own = await fixture.login();
    fixture.advance(900001);
    await request(own.cookie);
    return { ...own, step: await fixture.currentCode(own.user.id) };
  }

  it("persists a session-bound hashed challenge and an encrypted email in one transaction", async () => {
    const own = await fixture.login();
    const before = await fixture.sessionRows(own.user.id);
    await request(own.cookie);
    const step = await fixture.currentCode(own.user.id);
    expect(step.challenge).toMatchObject({
      userId: own.user.id,
      purpose: "step_up",
      sessionId: before[0].id,
      attempts: 0,
      consumedAt: null,
    });
    expect(step.challenge.expiresAt.getTime()).toBe(
      fixture.now().getTime() + 600000,
    );
    expect(step.challenge.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(step.challenge.codeHash).not.toBe(step.code);
    expect(JSON.stringify(step.job.data)).not.toContain(step.message.text);
    expect(JSON.stringify(step.job.data)).not.toContain(own.user.email);
    expect(step.message.to).toBe(own.user.email);
    expect(await fixture.sessionRows(own.user.id)).toEqual(before);
  });

  it("updates only the current lastOtpAt and preserves expiry and acting access", async () => {
    const own = await fixture.login({ owner: true });
    const other = await fixture.loginAs(own.user, { index: 1 });
    const actor = await fixture.apps[0].sessions.requireSession({
      headers: { cookie: own.cookie },
    });
    await fixture.db.transaction((tx) =>
      tx
        .update(sessions)
        .set({
          actingCompanyId: v7(),
          actingReason: "Proof entry",
          actingUntil: new Date(fixture.now().getTime() + 8 * 3600000),
        })
        .where(eq(sessions.id, actor.session.id)),
    );
    const before = await fixture.sessionRows(own.user.id);
    fixture.advance(900001);
    await request(own.cookie);
    const step = await fixture.currentCode(own.user.id);
    const response = await fixture.post(
      "stepUp",
      { code: step.code },
      { cookie: own.cookie },
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: { ok: true } });
    expect(response.headers["set-cookie"]).toBeUndefined();
    const after = await fixture.sessionRows(own.user.id);
    expect(after).toHaveLength(2);
    for (const row of before) {
      expect(after.find((item) => item.id === row.id)).toEqual(
        row.id === actor.session.id
          ? { ...row, lastOtpAt: fixture.now() }
          : row,
      );
    }
    expect(
      (await fixture.challenges(own.user.id)).find(
        (row) => row.id === step.challenge.id,
      )?.consumedAt,
    ).toEqual(fixture.now());
    expect(
      (await fixture.post("refresh", {}, { cookie: other.cookie })).statusCode,
    ).toBe(200);
  });

  it("rejects login and step-up challenges on the wrong purpose without consuming them", async () => {
    const own = await fixture.login();
    const sessionsBefore = await fixture.sessionRows(own.user.id);
    await fixture.post("requestOtp", { email: own.user.email });
    const login = await fixture.currentCode(own.user.id);
    expect(
      (
        await fixture.post(
          "stepUp",
          { code: login.code },
          { cookie: own.cookie },
        )
      ).statusCode,
    ).toBe(401);
    expect((await fixture.currentCode(own.user.id)).challenge).toEqual(
      login.challenge,
    );
    await request(own.cookie);
    const step = await fixture.currentCode(own.user.id);
    expect(
      (
        await fixture.post("verifyOtp", {
          email: own.user.email,
          code: step.code,
        })
      ).statusCode,
    ).toBe(401);
    expect((await fixture.currentCode(own.user.id)).challenge).toEqual(
      step.challenge,
    );
    expect(await fixture.sessionRows(own.user.id)).toEqual(sessionsBefore);
  });

  it("rejects a correct code from another session without spending an attempt", async () => {
    const own = await fixture.login();
    const other = await fixture.loginAs(own.user, { index: 1 });
    fixture.advance(900001);
    await request(own.cookie);
    const step = await fixture.currentCode(own.user.id);
    const before = await fixture.sessionRows(own.user.id);
    expect(
      (
        await fixture.post(
          "stepUp",
          { code: step.code },
          { index: 1, cookie: other.cookie },
        )
      ).statusCode,
    ).toBe(401);
    expect((await fixture.currentCode(own.user.id)).challenge).toEqual(
      step.challenge,
    );
    expect(await fixture.sessionRows(own.user.id)).toEqual(before);
    expect(
      (
        await fixture.post(
          "stepUp",
          { code: step.code },
          { cookie: own.cookie },
        )
      ).statusCode,
    ).toBe(200);
  });

  it("commits five concurrent wrong attempts and refuses the correct sixth code", async () => {
    const own = await pending();
    const before = await fixture.sessionRows(own.user.id);
    const wrong = own.step.code === "000000" ? "000001" : "000000";
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        fixture.post(
          "stepUp",
          { code: wrong },
          { cookie: own.cookie, index: index % 2 },
        ),
      ),
    );
    expect(responses.every((response) => response.statusCode === 401)).toBe(
      true,
    );
    const row = (await fixture.challenges(own.user.id)).find(
      (row) => row.id === own.step.challenge.id,
    );
    expect(row).toMatchObject({ attempts: 5, consumedAt: fixture.now() });
    expect(
      (
        await fixture.post(
          "stepUp",
          { code: own.step.code },
          { cookie: own.cookie },
        )
      ).statusCode,
    ).toBe(401);
    expect(await fixture.sessionRows(own.user.id)).toEqual(before);
  });

  it("accepts a challenge once across concurrent requests and rejects replay", async () => {
    const own = await pending();
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        fixture.post(
          "stepUp",
          { code: own.step.code },
          { cookie: own.cookie, index: index % 2 },
        ),
      ),
    );
    expect(
      responses.filter((response) => response.statusCode === 200),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => response.statusCode === 401),
    ).toHaveLength(7);
    const before = await fixture.sessionRows(own.user.id);
    fixture.advance(1000);
    expect(
      (
        await fixture.post(
          "stepUp",
          { code: own.step.code },
          { cookie: own.cookie },
        )
      ).statusCode,
    ).toBe(401);
    expect(await fixture.sessionRows(own.user.id)).toEqual(before);
  });

  it.each([599999, 600000, 600001])(
    "checks challenge expiry at age %s ms",
    async (age) => {
      const own = await pending();
      const before = await fixture.sessionRows(own.user.id);
      fixture.advance(age);
      const response = await fixture.post(
        "stepUp",
        { code: own.step.code },
        { cookie: own.cookie },
      );
      expect(response.statusCode).toBe(age < 600000 ? 200 : 401);
      if (age >= 600000)
        expect(await fixture.sessionRows(own.user.id)).toEqual(before);
    },
  );

  it("a login request replaces an outstanding step-up challenge", async () => {
    const own = await pending();
    await fixture.post("requestOtp", { email: own.user.email });
    const latest = await fixture.currentCode(own.user.id);
    expect(latest.challenge.purpose).toBe("login");
    const before = await fixture.sessionRows(own.user.id);
    expect(
      (
        await fixture.post(
          "stepUp",
          { code: own.step.code },
          { cookie: own.cookie },
        )
      ).statusCode,
    ).toBe(401);
    expect((await fixture.currentCode(own.user.id)).challenge).toEqual(
      latest.challenge,
    );
    expect(await fixture.sessionRows(own.user.id)).toEqual(before);
  });

  it("shares the email request limit with login across API instances", async () => {
    const own = await fixture.login();
    await request(own.cookie);
    await request(own.cookie, 1);
    const before = await fixture.challenges(own.user.id);
    const jobs = await fixture.jobs();
    await request(own.cookie);
    expect(
      (
        await fixture.post(
          "requestOtp",
          { email: own.user.email },
          { index: 1 },
        )
      ).statusCode,
    ).toBe(200);
    expect(await fixture.challenges(own.user.id)).toEqual(before);
    expect(await fixture.jobs()).toEqual(jobs);
    fixture.advance(600000);
    await request(own.cookie, 1);
    expect((await fixture.currentCode(own.user.id)).challenge.id).not.toBe(
      before.at(-1)?.id,
    );
  });

  it("serializes login and step-up replacement without crossing lock order", async () => {
    const own = await fixture.login();
    const responses = await Promise.all([
      fixture.post("requestStepUp", {}, { cookie: own.cookie }),
      fixture.post("requestOtp", { email: own.user.email }, { index: 1 }),
    ]);
    expect(responses.every((response) => response.statusCode === 200)).toBe(
      true,
    );
    const challenges = await fixture.challenges(own.user.id);
    expect(challenges).toHaveLength(3);
    expect(challenges.filter((row) => row.consumedAt === null)).toHaveLength(1);
    const live = await fixture.currentCode(own.user.id);
    const verified =
      live.challenge.purpose === "login"
        ? await fixture.post("verifyOtp", {
            email: own.user.email,
            code: live.code,
          })
        : await fixture.post(
            "stepUp",
            { code: live.code },
            { cookie: own.cookie },
          );
    expect(verified.statusCode).toBe(200);
  });

  it("shares the IP limit with unknown-email login requests", async () => {
    const own = await fixture.login();
    for (let index = 0; index < 19; index++) {
      expect(
        (
          await fixture.post(
            "requestOtp",
            { email: `unknown${index}@example.test` },
            { index: index % 2 },
          )
        ).statusCode,
      ).toBe(200);
    }
    const before = await fixture.challenges(own.user.id);
    await request(own.cookie);
    expect(await fixture.challenges(own.user.id)).toEqual(before);
    expect(
      (await fixture.limits()).find((row) => row.scope === "otp.ip")?.hits,
    ).toHaveLength(20);
  });

  it.each([null, "null", "https://hostile.example"])(
    "rejects Origin %s before sending or verifying a code",
    async (origin) => {
      const own = await pending();
      const before = await fixture.sessionRows(own.user.id);
      const challenges = await fixture.challenges(own.user.id);
      const jobs = await fixture.jobs();
      const limits = await fixture.limits();
      for (const [path, body] of [
        ["requestStepUp", {}],
        ["stepUp", { code: own.step.code }],
      ] as const) {
        const response = await fixture.post(path, body, {
          cookie: own.cookie,
          origin,
        });
        expect(response.statusCode).toBe(403);
        expect(response.headers["set-cookie"]).toBeUndefined();
      }
      expect(await fixture.sessionRows(own.user.id)).toEqual(before);
      expect(await fixture.challenges(own.user.id)).toEqual(challenges);
      expect(await fixture.jobs()).toEqual(jobs);
      expect(await fixture.limits()).toEqual(limits);
    },
  );

  it("rejects identity selectors and malformed codes without spending attempts", async () => {
    const own = await pending();
    const before = await fixture.challenges(own.user.id);
    for (const [path, body] of [
      ["requestStepUp", { email: "other@example.test" }],
      ["requestStepUp", null],
      ["stepUp", { code: own.step.code, sessionId: v7() }],
      ["stepUp", { code: 123456 }],
      ["stepUp", { code: "12345" }],
    ] as const) {
      const response = await fixture.post(path, body, { cookie: own.cookie });
      expect(response.statusCode).toBe(400);
    }
    for (const path of ["requestStepUp", "stepUp"]) {
      expect(
        (
          await fixture.post(
            path,
            path === "stepUp" ? { code: own.step.code } : {},
          )
        ).statusCode,
      ).toBe(401);
    }
    expect(await fixture.challenges(own.user.id)).toEqual(before);
  });

  it.each(["revoked", "inactive", "expired"])(
    "rejects a %s session after waiting for its user lock",
    async (state) => {
      const own = await pending();
      const before = await fixture.sessionRows(own.user.id);
      const challenge = await fixture.currentCode(own.user.id);
      const held = await fixture.holdUser(own.user.id, async (tx) => {
        if (state === "revoked")
          await tx
            .update(sessions)
            .set({ revokedAt: fixture.now() })
            .where(eq(sessions.id, before[0].id));
        if (state === "inactive")
          await tx
            .update(users)
            .set({ deactivatedAt: fixture.now() })
            .where(eq(users.id, own.user.id));
      });
      const verifying = fixture.post(
        "stepUp",
        { code: own.step.code },
        { cookie: own.cookie },
      );
      try {
        await fixture.waitForLock();
        if (state === "expired") fixture.setTime(before[0].expiresAt.getTime());
      } finally {
        held.release();
        await held.done;
      }
      expect((await verifying).statusCode).toBe(401);
      expect((await fixture.sessionRows(own.user.id))[0].lastOtpAt).toEqual(
        before[0].lastOtpAt,
      );
      expect((await fixture.currentCode(own.user.id)).challenge).toEqual(
        challenge.challenge,
      );
      expect(
        (await fixture.post("requestStepUp", {}, { cookie: own.cookie }))
          .statusCode,
      ).toBe(401);
    },
  );

  it("rolls back consumption when the freshness write fails", async () => {
    const own = await pending();
    const before = await fixture.sessionRows(own.user.id);
    await fixture.owner(`CREATE FUNCTION fail_freshness_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Proof freshness failure'; END $$;
      CREATE TRIGGER fail_freshness_fixture BEFORE UPDATE OF last_otp_at ON sessions FOR EACH ROW EXECUTE FUNCTION fail_freshness_fixture()`);
    try {
      const response = await fixture.post(
        "stepUp",
        { code: own.step.code },
        { cookie: own.cookie },
      );
      expect(response.statusCode).toBe(500);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect((await fixture.currentCode(own.user.id)).challenge).toEqual(
        own.step.challenge,
      );
      expect(await fixture.sessionRows(own.user.id)).toEqual(before);
    } finally {
      await fixture.owner(
        "DROP TRIGGER fail_freshness_fixture ON sessions; DROP FUNCTION fail_freshness_fixture()",
      );
    }
  });

  it("rolls back the new challenge and limiter hits when enqueue fails", async () => {
    const own = await fixture.login();
    const before = await fixture.challenges(own.user.id);
    const limits = await fixture.limits();
    const jobs = await fixture.jobs();
    await fixture.owner(`CREATE FUNCTION fail_step_email_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Proof queue failure'; END $$;
      CREATE TRIGGER fail_step_email_fixture BEFORE INSERT ON pgboss.job FOR EACH ROW EXECUTE FUNCTION fail_step_email_fixture()`);
    try {
      expect(
        (await fixture.post("requestStepUp", {}, { cookie: own.cookie }))
          .statusCode,
      ).toBe(500);
      expect(await fixture.challenges(own.user.id)).toEqual(before);
      expect(await fixture.limits()).toEqual(limits);
      expect(await fixture.jobs()).toEqual(jobs);
    } finally {
      await fixture.owner(
        "DROP TRIGGER fail_step_email_fixture ON pgboss.job; DROP FUNCTION fail_step_email_fixture()",
      );
    }
  });

  it("delivers a usable step-up code through the compiled API and worker", async () => {
    const own = await fixture.login();
    await fixture.db.transaction((tx) =>
      tx
        .update(sessions)
        .set({ lastOtpAt: new Date(fixture.now().getTime() - 900001) })
        .where(eq(sessions.userId, own.user.id)),
    );
    const api = await fixture.startApi();
    const headers = {
      origin: "http://anar.example.test",
      cookie: own.cookie,
      "content-type": "application/json",
    };
    const requested = await fetch(`${api.url}/api/auth/requestStepUp`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(requested.status).toBe(200);
    await requested.body?.cancel();
    const step = await fixture.currentCode(own.user.id);
    await fixture.startWorker();
    await expect
      .poll(
        async () =>
          (await fixture.jobs()).find((job) => job.id === step.job.id)?.state,
        { timeout: 20000 },
      )
      .toBe("completed");
    const messages = await fixture.mailpit.messages();
    expect(messages).toHaveLength(1);
    const delivered = await fixture.mailpit.message(messages[0].ID);
    expect(delivered.To.map((recipient) => recipient.Address)).toEqual([
      own.user.email,
    ]);
    expect(delivered.Text).toBe(step.message.text);
    expect((delivered as typeof delivered & { HTML: string }).HTML).toBe(
      step.message.html,
    );
    expect(delivered.Subject).not.toContain("sign-in");
    const code = delivered.Text.match(/\b\d{6}\b/)?.[0];
    expect(code).toBe(step.code);
    const before = await fixture.sessionRows(own.user.id);
    const verified = await fetch(`${api.url}/api/auth/stepUp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ code }),
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ ok: true, data: { ok: true } });
    expect(verified.headers.get("set-cookie")).toBeNull();
    const [after] = await fixture.sessionRows(own.user.id);
    expect(after).toEqual({ ...before[0], lastOtpAt: after.lastOtpAt });
    expect(after.lastOtpAt.getTime()).toBeGreaterThan(
      before[0].lastOtpAt.getTime(),
    );
    expect(
      (await fixture.challenges(own.user.id)).find(
        (row) => row.id === step.challenge.id,
      )?.consumedAt,
    ).toEqual(after.lastOtpAt);
    await fixture.stopProcesses();
    expect(fixture.processLogs.join("")).not.toContain(delivered.Text);
    expect(fixture.processLogs.join("")).not.toContain(own.user.email);
  });
});
