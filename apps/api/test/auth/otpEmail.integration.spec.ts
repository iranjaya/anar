import { otpCodes, users } from "@anar/db/platform";
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
import { type AuthFixture, startAuthFixture } from "./fixture.js";

describe("production OTP delivery through the compiled worker", () => {
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

  async function pendingCode() {
    const user = await fixture.seedUser();
    expect(
      (await fixture.post("requestOtp", { email: user.email })).statusCode,
    ).toBe(200);
    return { user, ...(await fixture.currentCode(user.id)) };
  }

  async function waitForState(id: string, state: string) {
    await expect
      .poll(
        async () => (await fixture.jobs()).find((job) => job.id === id)?.state,
        { timeout: 20000 },
      )
      .toBe(state);
    const job = (await fixture.jobs()).find((job) => job.id === id);
    if (!job) throw new Error("Expected a persisted proof job");
    return job;
  }

  it("delivers a usable code to Mailpit through the real production registration", async () => {
    const issued = await pendingCode();
    const stored = JSON.stringify(issued.job.data);
    expect(stored).not.toContain(issued.user.email);
    expect(stored).not.toContain(issued.message.text);
    expect(Object.keys(issued.job.data).sort()).toEqual(
      ["kind", "referenceId", "expiresAt", "encryptedMessage"].sort(),
    );
    await fixture.startWorker();
    await waitForState(issued.job.id, "completed");
    await expect
      .poll(async () => (await fixture.mailpit.messages()).length)
      .toBe(1);
    const [summary] = await fixture.mailpit.messages();
    const message = await fixture.mailpit.message(summary.ID);
    expect(message.To.map((recipient) => recipient.Address)).toEqual([
      issued.user.email,
    ]);
    expect(message.Subject).toBe(`${issued.code} is your Anar sign-in code`);
    expect(message.Text).toBe(issued.message.text);
    expect((message as typeof message & { HTML: string }).HTML).toBe(
      issued.message.html,
    );
    expect(
      (await fixture.mailpit.headers(summary.ID))["X-Anar-Delivery-Key"],
    ).toEqual([issued.job.key]);
    const deliveredCode = message.Text.match(/\b\d{6}\b/)?.[0];
    expect(deliveredCode).toBe(issued.code);
    const login = await fixture.post("verifyOtp", {
      email: issued.user.email,
      code: deliveredCode,
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["set-cookie"]).toBeDefined();
    await fixture.stopProcesses();
    expect(fixture.processLogs.join("")).not.toContain(message.Text);
    expect(fixture.processLogs.join("")).not.toContain(issued.user.email);
  });

  it("skips replaced, consumed, expired and globally deactivated challenges", async () => {
    const replaced = await pendingCode();
    await fixture.post("requestOtp", { email: replaced.user.email });
    const latest = await fixture.currentCode(replaced.user.id);
    const consumed = await pendingCode();
    const expired = await pendingCode();
    const inactive = await pendingCode();
    const expiredAt = new Date(Date.now() - 1000);
    await fixture.db.transaction(async (tx) => {
      await tx
        .update(otpCodes)
        .set({ consumedAt: fixture.now() })
        .where(eq(otpCodes.id, consumed.challenge.id));
      await tx
        .update(otpCodes)
        .set({ expiresAt: expiredAt })
        .where(eq(otpCodes.id, expired.challenge.id));
      await tx
        .update(users)
        .set({ deactivatedAt: fixture.now() })
        .where(eq(users.id, inactive.user.id));
      await tx.execute(
        sql`update pgboss.job set data = ${JSON.stringify({ ...expired.job.data, expiresAt: expiredAt.toISOString() })}::jsonb where id = ${expired.job.id}`,
      );
    });
    expect(
      (await fixture.challenges(replaced.user.id)).find(
        (row) => row.id === replaced.challenge.id,
      )?.consumedAt,
    ).not.toBeNull();
    await fixture.startWorker();
    await expect
      .poll(
        async () =>
          (await fixture.jobs()).every((job) => job.state === "completed"),
        { timeout: 20000 },
      )
      .toBe(true);
    expect(await fixture.mailpit.messages()).toHaveLength(1);
    const [summary] = await fixture.mailpit.messages();
    expect((await fixture.mailpit.message(summary.ID)).Text).toBe(
      latest.message.text,
    );
  });

  it("retries the persisted encrypted message with the same delivery key after restart", async () => {
    const issued = await pendingCode();
    await fixture.startWorker("http://127.0.0.1:1");
    const failed = await waitForState(issued.job.id, "retry");
    expect(JSON.stringify(failed.output)).toContain("Job delivery failed");
    expect(JSON.stringify(failed.output)).not.toContain(issued.message.text);
    expect(failed.key).toBe(issued.job.key);
    await fixture.stopProcesses();
    await fixture.rows(
      sql`update pgboss.job set start_after = now() where id = ${issued.job.id}`,
    );
    await fixture.startWorker();
    const completed = await waitForState(issued.job.id, "completed");
    expect(completed.retries).toBe(1);
    expect(completed.key).toBe(issued.job.key);
    expect(completed.data).toEqual(issued.job.data);
    expect(await fixture.mailpit.messages()).toHaveLength(1);
    const [summary] = await fixture.mailpit.messages();
    expect(
      (await fixture.mailpit.headers(summary.ID))["X-Anar-Delivery-Key"],
    ).toEqual([issued.job.key]);
    await fixture.stopProcesses();
    expect(fixture.processLogs.join("")).not.toContain(issued.message.text);
  });

  it("does not send a retry once its persisted challenge has expired", async () => {
    const issued = await pendingCode();
    await fixture.startWorker("http://127.0.0.1:1");
    await waitForState(issued.job.id, "retry");
    await fixture.stopProcesses();
    const expiresAt = new Date(Date.now() - 1000);
    await fixture.db.transaction(async (tx) => {
      await tx
        .update(otpCodes)
        .set({ expiresAt })
        .where(eq(otpCodes.id, issued.challenge.id));
      await tx.execute(
        sql`update pgboss.job set start_after = now(), data = ${JSON.stringify({ ...issued.job.data, expiresAt: expiresAt.toISOString() })}::jsonb where id = ${issued.job.id}`,
      );
    });
    await fixture.startWorker();
    await waitForState(issued.job.id, "completed");
    expect(await fixture.mailpit.messages()).toEqual([]);
  });

  it.each(["payload", "key", "recipient"])(
    "refuses a malformed %s without sending or persisting plaintext errors",
    async (kind) => {
      const issued = await pendingCode();
      let data: object = issued.job.data;
      if (kind === "payload")
        data = { ...issued.job.data, unexpected: issued.message.text };
      if (kind === "recipient") {
        data = {
          ...issued.job.data,
          encryptedMessage: fixture.codec.encryptMessage(
            { ...issued.message, to: "wrong@example.test" },
            issued.job.key,
          ),
        };
      }
      const key = kind === "key" ? "wrong-key" : issued.job.key;
      await fixture.rows(
        sql`update pgboss.job set data = ${JSON.stringify(data)}::jsonb, singleton_key = ${key} where id = ${issued.job.id}`,
      );
      await fixture.startWorker();
      const failed = await waitForState(issued.job.id, "retry");
      expect(await fixture.mailpit.messages()).toEqual([]);
      expect(JSON.stringify(failed.output)).not.toContain(issued.message.text);
      expect(JSON.stringify(failed.output)).not.toContain(issued.user.email);
    },
  );
});
