import { companyMembers } from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startSummaryEmailFixture } from "./summaryEmailFixture.js";

describe("summary email fallback in the database", () => {
  let run: Awaited<ReturnType<typeof startSummaryEmailFixture>>;
  beforeAll(async () => {
    run = await startSummaryEmailFixture();
  });
  beforeEach(async () => {
    await run.fixture.reset();
  });
  afterAll(async () => {
    await run?.close();
  });

  it("queues IDs only when push is off and sends once", async () => {
    const { company, user } = await run.setup();
    const job = await run.createNotice(company, user.id, "daily", false);
    const queued = await run.fixture.rows<{
      data: Record<string, unknown>;
      key: string;
    }>(sql`SELECT data, singleton_key AS key FROM pgboss.job
      WHERE name = 'notify.summary_email'`);
    expect(queued).toHaveLength(1);
    expect(queued[0].data).toEqual(job);
    expect(queued[0].key).toBe(
      `summary:${company.companyId}:${job.notificationId}`,
    );
    const sent: string[] = [];
    const worker = run.emailWorker(async (message) => {
      sent.push(message.to);
    });
    await worker.deliver(job, run.control());
    await worker.deliver(job, run.control());
    expect(sent).toEqual([user.email]);
    expect(await run.ledger(company, job.notificationId)).toMatchObject([
      { channel: "email", state: "sent", attempts: 1 },
    ]);
    expect(
      (await run.storedNotice(company, job.notificationId)).emailedAt,
    ).not.toBeNull();
    const [email] = await run.ledger(company, job.notificationId);
    expect(email.encryptedMessage).not.toContain(user.email);
  });

  it("stops push replay after fallback starts, even if a device is added", async () => {
    const { company, user } = await run.setup();
    const job = await run.createNotice(company, user.id, "daily", true);
    const pushes: string[] = [];
    const worker = run.pushWorker(async (target) => {
      pushes.push(target.endpoint);
      return { status: 201, retryAfter: null };
    });
    await worker.deliverPush(job, run.control());
    expect(
      (await run.ledger(company, job.notificationId))
        .map((row) => [row.channel, row.state])
        .sort(),
    ).toEqual([
      ["email", "pending"],
      ["push", "skipped"],
    ]);
    await run.device(company, user);
    await worker.deliverPush(job, run.control());
    expect(pushes).toEqual([]);
    const sent: string[] = [];
    await run
      .emailWorker(async (message) => {
        sent.push(message.to);
      })
      .deliver(job, run.control());
    expect(sent).toEqual([user.email]);
  });

  it("does not email after one device accepts push", async () => {
    const { company, user } = await run.setup();
    const endpoint = await run.device(company, user);
    const job = await run.createNotice(company, user.id, "daily", true);
    const pushes: string[] = [];
    await run
      .pushWorker(async (target) => {
        pushes.push(target.endpoint);
        return { status: 201, retryAfter: null };
      })
      .deliverPush(job, run.control());
    const sent: string[] = [];
    await run
      .emailWorker(async (message) => {
        sent.push(message.to);
      })
      .deliver(job, run.control());
    expect(pushes).toEqual([endpoint]);
    expect(sent).toEqual([]);
    expect(
      (await run.ledger(company, job.notificationId)).map((row) => row.channel),
    ).toEqual(["push"]);
    expect(
      (await run.storedNotice(company, job.notificationId)).pushedAt,
    ).not.toBeNull();
  });

  it("queues email after the only device returns 410", async () => {
    const { company, user } = await run.setup();
    await run.device(company, user);
    const job = await run.createNotice(company, user.id, "daily", true);
    await run
      .pushWorker(async () => ({ status: 410, retryAfter: null }))
      .deliverPush(job, run.control());
    expect(
      (await run.ledger(company, job.notificationId))
        .map((row) => [row.channel, row.state])
        .sort(),
    ).toEqual([
      ["email", "pending"],
      ["push", "failed"],
    ]);
    const sent: string[] = [];
    await run
      .emailWorker(async (message) => {
        sent.push(message.to);
      })
      .deliver(job, run.control());
    expect(sent).toEqual([user.email]);
  });

  it("waits for a rate limit without using a queue retry, then sends email after push gives up", async () => {
    const { company, user } = await run.setup();
    await run.device(company, user);
    const job = await run.createNotice(company, user.id, "daily", true);
    let attempts = 0;
    const worker = run.pushWorker(async () => {
      attempts += 1;
      return { status: 429, retryAfter: "120" };
    });
    for (let index = 0; index < 4; index += 1) {
      await worker.deliverPush(job, run.control());
      if (index === 0) {
        const queued = await run.fixture.rows<{
          start_after: Date;
          retry_count: number;
        }>(sql`SELECT start_after, retry_count FROM pgboss.job
          WHERE name = 'notify.push' AND singleton_key LIKE 'push-wait:%'`);
        expect(queued).toHaveLength(1);
        expect(new Date(queued[0].start_after).getTime()).toBe(
          run.fixture.now().getTime() + 120_000,
        );
        expect(queued[0].retry_count).toBe(0);
      }
      if (index < 3) run.fixture.advance(120_000);
    }
    expect(attempts).toBe(4);
    expect(
      (await run.ledger(company, job.notificationId))
        .map((row) => [row.channel, row.state, row.attempts])
        .sort(),
    ).toEqual([
      ["email", "pending", 0],
      ["push", "failed", 4],
    ]);
    const sent: string[] = [];
    await run
      .emailWorker(async (message) => {
        sent.push(message.to);
      })
      .deliver(job, run.control());
    expect(sent).toEqual([user.email]);
  });

  it("cancels the saved envelope if email or membership changes", async () => {
    const { company, user } = await run.setup();
    const job = await run.createNotice(company, user.id, "daily", false);
    const failing = run.emailWorker(async () => {
      throw new Error("Provider did not answer");
    });
    await expect(failing.deliver(job, run.control())).rejects.toThrow();
    await run.fixture.db.transaction((tx) =>
      tx.execute(
        sql`UPDATE users SET email = 'new@example.test' WHERE id = ${user.id}`,
      ),
    );
    const sent: string[] = [];
    await run
      .emailWorker(async (message) => {
        sent.push(message.to);
      })
      .deliver(job, run.control());
    expect(sent).toEqual([]);
    expect((await run.ledger(company, job.notificationId))[0].state).toBe(
      "skipped",
    );

    const other = await run.fixture.seedUser();
    const otherMember = await run.fixture.seedMember(
      company,
      other.id,
      "active",
      "admin",
    );
    const otherJob = await run.createNotice(company, other.id, "daily", false);
    await expect(failing.deliver(otherJob, run.control())).rejects.toThrow();
    await run.scoped(company, (tx) =>
      tx
        .update(companyMembers)
        .set({ status: "deactivated", deactivatedAt: run.fixture.now() })
        .where(eq(companyMembers.id, otherMember.id)),
    );
    await run
      .emailWorker(async (message) => {
        sent.push(message.to);
      })
      .deliver(otherJob, run.control());
    expect(sent).toEqual([]);
    expect((await run.ledger(company, otherJob.notificationId))[0].state).toBe(
      "skipped",
    );
  });

  it("marks a failed weekly send indeterminate after 23 hours", async () => {
    const { company, user } = await run.setup("weekly");
    const job = await run.createNotice(company, user.id, "weekly", false);
    const keys: string[] = [];
    await expect(
      run
        .emailWorker(async (message) => {
          keys.push(message.deliveryKey);
          throw new Error("Provider did not answer");
        })
        .deliver(job, run.control()),
    ).rejects.toThrow();
    run.fixture.advance(23 * 60 * 60_000 + 1);
    await run
      .emailWorker(async (message) => {
        keys.push(message.deliveryKey);
      })
      .deliver(job, run.control());
    expect(keys).toEqual([
      `summary:${company.companyId}:${job.notificationId}`,
    ]);
    expect((await run.ledger(company, job.notificationId))[0].state).toBe(
      "indeterminate",
    );
    expect(
      (await run.storedNotice(company, job.notificationId)).emailedAt,
    ).toBeNull();
  });
});
