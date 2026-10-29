import { authRateLimits, otpCodes, users } from "@anar/db/platform";
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { type AuthFixture, publicOrigin, startAuthFixture } from "./fixture.js";

describe("OTP requests on Postgres", () => {
  let fixture: AuthFixture;
  beforeAll(async () => {
    fixture = await startAuthFixture();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterEach(async () => {
    await fixture.stopProcesses();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  it("returns the same accepted response for known, unknown, inactive and throttled email", async () => {
    const active = await fixture.seedUser("known@example.test");
    const inactive = await fixture.seedUser("inactive@example.test");
    await fixture.db.transaction((tx) =>
      tx
        .update(users)
        .set({ deactivatedAt: fixture.now() })
        .where(eq(users.id, inactive.id)),
    );
    for (const email of [
      active.email,
      active.email,
      active.email,
      active.email,
      "unknown@example.test",
      inactive.email,
    ]) {
      const response = await fixture.post("requestOtp", { email });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, data: { ok: true } });
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    expect(await fixture.jobs()).toHaveLength(3);
    expect(await fixture.challenges(active.id)).toHaveLength(3);
    expect(await fixture.challenges(inactive.id)).toEqual([]);
    const limits = await fixture.limits();
    expect(limits.find((row) => row.scope === "otp.ip")?.hits).toHaveLength(6);
    const stored = JSON.stringify(limits);
    for (const raw of [
      active.email,
      inactive.email,
      "unknown@example.test",
      "198.51.100.10",
    ])
      expect(stored).not.toContain(raw);
  });

  it("admits at most three parallel requests for an email across independent API pools", async () => {
    const user = await fixture.seedUser();
    const results = await Promise.all(
      Array.from({ length: 18 }, (_, index) =>
        fixture.post(
          "requestOtp",
          { email: user.email },
          { index: index % 2, ip: `198.51.100.${index + 20}` },
        ),
      ),
    );
    expect(results.every((response) => response.statusCode === 200)).toBe(true);
    expect(await fixture.jobs()).toHaveLength(3);
    const challenges = await fixture.challenges(user.id);
    expect(
      challenges.filter((challenge) => challenge.consumedAt === null),
    ).toHaveLength(1);
    expect(
      challenges.filter((challenge) => challenge.consumedAt !== null),
    ).toHaveLength(2);
    expect(
      (await fixture.limits()).find((limit) => limit.scope === "otp.email")
        ?.hits,
    ).toHaveLength(3);
  });

  it("shares the IP limit across two compiled API processes and ignores forged forwarding headers", async () => {
    const people = await Promise.all(
      Array.from({ length: 26 }, () => fixture.seedUser()),
    );
    const apis = await Promise.all([fixture.startApi(), fixture.startApi()]);
    const responses = await Promise.all(
      people.map(async (user, index) => {
        const response = await fetch(
          `${apis[index % 2].url}/api/auth/requestOtp`,
          {
            method: "POST",
            headers: {
              Origin: publicOrigin,
              "Content-Type": "application/json",
              "X-Forwarded-For": `203.0.113.${index + 1}`,
            },
            body: JSON.stringify({ email: user.email }),
            signal: AbortSignal.timeout(10000),
          },
        );
        expect(await response.json()).toEqual({ ok: true, data: { ok: true } });
        return response.status;
      }),
    );
    expect(responses).toEqual(Array(26).fill(200));
    expect(await fixture.jobs()).toHaveLength(20);
    const limits = await fixture.limits();
    expect(limits.filter((row) => row.scope === "otp.ip")).toHaveLength(1);
    expect(limits.find((row) => row.scope === "otp.ip")?.hits).toHaveLength(20);
    expect(limits.filter((row) => row.scope === "otp.email")).toHaveLength(20);
    await fixture.stopProcesses();
    const logs = fixture.processLogs.join("");
    for (const user of people) expect(logs).not.toContain(user.email);
    for (const job of await fixture.jobs())
      expect(logs).not.toContain(
        fixture.codec.decryptMessage(job.data.encryptedMessage, job.key).text,
      );
  });

  it("prunes email hits at exactly ten minutes", async () => {
    const user = await fixture.seedUser();
    for (let i = 0; i < 4; i++)
      await fixture.post("requestOtp", { email: user.email });
    fixture.advance(600000 - 1);
    await fixture.post("requestOtp", { email: user.email });
    expect(await fixture.jobs()).toHaveLength(3);
    fixture.advance(1);
    await fixture.post("requestOtp", { email: user.email });
    expect(await fixture.jobs()).toHaveLength(4);
    expect(
      (await fixture.limits()).find((limit) => limit.scope === "otp.email")
        ?.hits,
    ).toHaveLength(1);
  });

  it("prunes IP hits at exactly one hour and never creates email keys while blocked", async () => {
    for (let i = 0; i < 21; i++)
      await fixture.post("requestOtp", { email: `unknown-${i}@example.test` });
    expect(
      (await fixture.limits()).filter((row) => row.scope === "otp.email"),
    ).toHaveLength(20);
    fixture.advance(3600000 - 1);
    await fixture.post("requestOtp", { email: "still-blocked@example.test" });
    expect(
      (await fixture.limits()).filter((row) => row.scope === "otp.email"),
    ).toHaveLength(20);
    fixture.advance(1);
    await fixture.post("requestOtp", { email: "window-reset@example.test" });
    const limits = await fixture.limits();
    expect(limits.find((row) => row.scope === "otp.ip")?.hits).toHaveLength(1);
    expect(limits.filter((row) => row.scope === "otp.email")).toHaveLength(21);
    expect(await fixture.jobs()).toEqual([]);
  });

  it("rolls back limiter hits and challenge replacement when enqueue fails", async () => {
    const user = await fixture.seedUser();
    await fixture.post("requestOtp", { email: user.email });
    const beforeCodes = await fixture.challenges(user.id);
    const beforeLimits = (await fixture.limits()).sort((a, b) =>
      a.keyHash.localeCompare(b.keyHash),
    );
    await fixture.owner(
      "REVOKE INSERT ON pgboss.job, pgboss.job_common FROM anar_app",
    );
    try {
      const response = await fixture.post("requestOtp", { email: user.email });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        ok: false,
        error: "unavailable",
      });
      expect(await fixture.challenges(user.id)).toEqual(beforeCodes);
      expect(
        (await fixture.limits()).sort((a, b) =>
          a.keyHash.localeCompare(b.keyHash),
        ),
      ).toEqual(beforeLimits);
      expect(await fixture.jobs()).toHaveLength(1);
    } finally {
      await fixture.owner(
        "GRANT INSERT ON pgboss.job, pgboss.job_common TO anar_app",
      );
    }
  });

  it("rejects hostile Origin and forged identity before any auth write", async () => {
    const user = await fixture.seedUser();
    for (const origin of [
      null,
      "null",
      "https://hostile.example",
      `${publicOrigin}.evil.test`,
    ]) {
      expect(
        (await fixture.post("requestOtp", { email: user.email }, { origin }))
          .statusCode,
      ).toBe(403);
    }
    expect(
      (
        await fixture.post("requestOtp", {
          email: user.email,
          userId: user.id,
          platformRole: "dna",
        })
      ).statusCode,
    ).toBe(400);
    expect(await fixture.challenges(user.id)).toEqual([]);
    expect(await fixture.jobs()).toEqual([]);
    expect(await fixture.limits()).toEqual([]);
  });

  it("keeps runtime auth tables append or update only after repeated setup", async () => {
    const rows = await fixture.rows(sql`select table_name,
      has_table_privilege(current_user, 'public.' || table_name, 'DELETE') as can_delete,
      has_table_privilege(current_user, 'public.' || table_name, 'TRUNCATE') as can_truncate
      from (values ('users'), ('otp_codes'), ('auth_rate_limits'), ('sessions'), ('audit_log')) as t(table_name)`);
    expect(rows).toHaveLength(5);
    expect(
      rows.every(
        (row) => row.can_delete === false && row.can_truncate === false,
      ),
    ).toBe(true);
    expect(
      await fixture.db.transaction((tx) => tx.select().from(authRateLimits)),
    ).toEqual([]);
    expect(
      await fixture.db.transaction((tx) => tx.select().from(otpCodes)),
    ).toEqual([]);
  });
});
