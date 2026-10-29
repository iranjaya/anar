import { inspect } from "node:util";
import {
  createEmailSender,
  createMailCodec,
  type JobRegistration,
} from "@anar/api/jobs";
import { publish } from "@anar/db/queue";
import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import { startFixture, type WorkerFixture } from "./support/fixture.js";

const envelope = z.strictObject({
  expiresAt: z.iso.datetime(),
  encryptedMessage: z.string(),
});

describe("encrypted delivery through the real worker", () => {
  let fixture: WorkerFixture;
  let codec: ReturnType<typeof createMailCodec>;
  let name: string;
  let key: string;
  let message: { to: string; subject: string; text: string };
  let logs: ReturnType<typeof vi.spyOn>[];

  beforeAll(async () => {
    fixture = await startFixture();
    codec = createMailCodec(fixture.env.MAIL_ENCRYPTION_KEY);
  });
  afterAll(async () => {
    await fixture?.close();
  });
  beforeEach(async () => {
    await fixture.mailpit.clear();
    await fixture.owner.query("truncate public.worker_heartbeats");
    name = await fixture.createQueue();
    key = v7();
    message = {
      to: `${key}@example.test`,
      subject: `Subject ${key}`,
      text: `Synthetic OTP 583921 ${key}`,
    };
    logs = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "warn"),
    ];
    for (const log of logs) log.mockImplementation(() => {});
  });
  afterEach(async () => {
    try {
      await fixture.stopWorkers();
      await expect
        .poll(() => fixture.activeConnections(), { timeout: 5000 })
        .toBe(0);
      const output = inspect(
        logs.map((log) => log.mock.calls),
        { depth: 10 },
      );
      for (const secret of Object.values(message))
        expect(output).not.toContain(secret);
    } finally {
      vi.restoreAllMocks();
    }
  });

  const payload = (expiresAt = new Date(Date.now() + 60000).toISOString()) => ({
    expiresAt,
    encryptedMessage: codec.encryptMessage(message, key),
  });
  const job = (beforeSend?: () => Promise<void>): JobRegistration => ({
    name,
    async run(work) {
      const data = envelope.parse(work.data);
      if (Date.parse(data.expiresAt) <= Date.now()) return;
      if (!work.deliveryKey) throw new Error("Fixture delivery key is missing");
      const decoded = codec.decryptMessage(
        data.encryptedMessage,
        work.deliveryKey,
      );
      await beforeSend?.();
      await createEmailSender({
        provider: "mailpit",
        url: fixture.mailpit.url,
        from: "sender@example.test",
      }).sendEmail({
        ...decoded,
        deliveryKey: work.deliveryKey,
        signal: work.signal,
      });
    },
  });
  const stored = async (id: string) =>
    (await fixture.queue.findJobs(name, { id }))[0];
  const delivered = async (id: string) => {
    await expect
      .poll(async () => (await stored(id))?.state, { timeout: 10000 })
      .toBe("completed");
    await expect
      .poll(async () => (await fixture.mailpit.messages()).length, {
        timeout: 5000,
      })
      .toBe(1);
    const [summary] = await fixture.mailpit.messages();
    const received = await fixture.mailpit.message(summary.ID);
    expect(received).toMatchObject({
      Subject: message.subject,
      Text: message.text,
    });
    expect(received.To.map((recipient) => recipient.Address)).toEqual([
      message.to,
    ]);
    const headers = await fixture.mailpit.headers(summary.ID);
    expect(headers["X-Anar-Delivery-Key"]).toEqual([key]);
    return received;
  };

  it("delivers only after the caller transaction commits", async () => {
    const worker = fixture.start([job()]);
    const id = await fixture.db.transaction(async (tx) => {
      await tx.execute(
        sql`insert into public.users (id, email, name) values (${key}, ${message.to}, 'Mail fixture')`,
      );
      const jobId = await publish(tx, name, payload(), key);
      expect(await fixture.queue.findJobs(name, { id: jobId })).toEqual([]);
      expect(await fixture.mailpit.messages()).toEqual([]);
      return jobId;
    });
    await delivered(id);
    const persisted = JSON.stringify(await stored(id));
    for (const secret of Object.values(message))
      expect(persisted).not.toContain(secret);
    expect(
      (
        await fixture.runtime.query(
          "select id from public.users where id = $1",
          [key],
        )
      ).rows,
    ).toEqual([{ id: key }]);
    worker.controller.abort();
    expect(await worker.done).toBeUndefined();
  });

  it("rolls back the user and job and sends no rolled-back mail", async () => {
    fixture.start([job()]);
    let rolledBack = "";
    await expect(
      fixture.db.transaction(async (tx) => {
        await tx.execute(
          sql`insert into public.users (id, email, name) values (${key}, ${message.to}, 'Rollback fixture')`,
        );
        rolledBack = await publish(tx, name, payload(), key);
        throw new Error("Rollback the mail fixture");
      }),
    ).rejects.toThrow("Rollback the mail fixture");
    const id = await fixture.publish(name, payload(), key);
    await delivered(id);
    expect(await stored(rolledBack)).toBeUndefined();
    expect(
      (
        await fixture.runtime.query(
          "select id from public.users where id = $1",
          [key],
        )
      ).rows,
    ).toEqual([]);
    expect(await fixture.mailpit.messages()).toHaveLength(1);
  });

  it("retries the same delivery key without persisting the thrown plaintext", async () => {
    let attempts = 0;
    fixture.start([
      job(async () => {
        if (++attempts === 1) throw new Error(message.text);
      }),
    ]);
    const id = await fixture.publish(name, payload(), key);
    await expect
      .poll(async () => (await stored(id))?.state, { timeout: 10000 })
      .toBe("retry");
    const failed = JSON.stringify((await stored(id)).output);
    expect(failed).toContain("Job delivery failed");
    expect(failed).not.toContain(message.text);
    expect((await stored(id)).singletonKey).toBe(key);
    await delivered(id);
    expect(attempts).toBe(2);
    expect((await stored(id)).retryCount).toBe(1);
  });

  it("consumes persisted pending work after a worker restart", async () => {
    const first = fixture.start([job()]);
    await expect
      .poll(
        async () =>
          (await fixture.runtime.query("select * from worker_heartbeats"))
            .rowCount,
      )
      .toBe(1);
    first.controller.abort();
    expect(await first.done).toBeUndefined();
    const id = await fixture.publish(name, payload(), key);
    expect((await stored(id)).state).toBe("created");
    expect(await fixture.mailpit.messages()).toEqual([]);
    const restarted = fixture.start([job()]);
    await delivered(id);
    expect(
      (await fixture.runtime.query("select * from worker_heartbeats")).rowCount,
    ).toBe(2);
    restarted.controller.abort();
    expect(await restarted.done).toBeUndefined();
  });

  it("completes an expired fixture without sending mail", async () => {
    fixture.start([job()]);
    const id = await fixture.publish(
      name,
      payload(new Date(Date.now() - 1000).toISOString()),
      key,
    );
    await expect
      .poll(async () => (await stored(id))?.state, { timeout: 10000 })
      .toBe("completed");
    expect(await fixture.mailpit.messages()).toEqual([]);
  });

  it("drains an active delivery before closing its pool", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const worker = fixture.start([
      job(async () => {
        entered.resolve();
        await release.promise;
      }),
    ]);
    const id = await fixture.publish(name, payload(), key);
    try {
      await entered.promise;
      worker.controller.abort();
      expect((await stored(id)).state).toBe("active");
      release.resolve();
      expect(await worker.done).toBeUndefined();
      await delivered(id);
      expect(await fixture.activeConnections()).toBe(0);
    } finally {
      release.resolve();
    }
  });
});
