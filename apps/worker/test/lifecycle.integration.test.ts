import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { startFixture, type WorkerFixture } from "./support/fixture.js";

describe("DB-backed worker lifecycle", () => {
  let fixture: WorkerFixture;
  const children: {
    child: ChildProcess;
    closed: Promise<unknown[]>;
    stderr(): string;
  }[] = [];
  const workerEntry = new URL("../dist/main.js", import.meta.url);
  beforeAll(async () => {
    fixture = await startFixture();
  });
  afterAll(async () => {
    await fixture?.close();
  });
  beforeEach(async () => {
    await fixture.owner.query("truncate worker_heartbeats");
  });
  afterEach(async () => {
    for (const process of children.splice(0)) {
      if (process.child.exitCode === null && process.child.signalCode === null)
        process.child.kill("SIGKILL");
      await process.closed;
    }
    await fixture.stopWorkers();
    await expect
      .poll(() => fixture.activeConnections(), { timeout: 5000 })
      .toBe(0);
  });

  const beats = () =>
    fixture.runtime.query(
      "select worker_id, last_seen_at from worker_heartbeats order by worker_id",
    );
  function launch(entry: URL, port?: number) {
    const env = {
      ...process.env,
      NODE_OPTIONS: "",
      DATABASE_URL: fixture.postgres.appUrl,
      EMAIL_TRANSPORT: "mailpit",
      MAILPIT_URL: fixture.mailpit.url,
      EMAIL_FROM: "sender@example.test",
      RESEND_API_KEY: "",
      HOST: "127.0.0.1",
      ...(port ? { PORT: String(port) } : {}),
    };
    const child = spawn(process.execPath, [fileURLToPath(entry)], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const running = {
      child,
      closed: once(child, "close"),
      stderr: () => stderr,
    };
    children.push(running);
    return running;
  }
  async function waitForExit(process: ReturnType<typeof launch>) {
    await expect
      .poll(() => process.child.exitCode ?? process.child.signalCode, {
        timeout: 7000,
      })
      .not.toBeNull();
    expect(await process.closed).toEqual([0, null]);
    expect(process.stderr()).toBe("");
  }

  it.each(["SIGINT", "SIGTERM"] as const)(
    "stops heartbeat and closes the compiled worker on %s",
    async (signal) => {
      const worker = launch(workerEntry);
      await expect
        .poll(async () => (await beats()).rowCount, { timeout: 8000 })
        .toBe(1);
      const before = (await beats()).rows;
      expect(worker.child.kill(signal)).toBe(true);
      await waitForExit(worker);
      expect((await beats()).rows).toEqual(before);
      expect(await fixture.activeConnections()).toBe(0);
    },
  );

  it("keeps the DB-backed worker running while the API restarts", async () => {
    const worker = launch(workerEntry);
    await expect
      .poll(async () => (await beats()).rowCount, { timeout: 8000 })
      .toBe(1);
    const socket = createServer();
    await new Promise<void>((resolve) =>
      socket.listen(0, "127.0.0.1", resolve),
    );
    const address = socket.address();
    if (!address || typeof address === "string")
      throw new Error("Expected a free API port");
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      socket.close((error) => (error ? reject(error) : resolve())),
    );
    expect(port).not.toBeOneOf([3000, 3001, 3100]);
    for (let restart = 0; restart < 2; restart++) {
      const api = launch(
        new URL("../../api/dist/main.js", import.meta.url),
        port,
      );
      await expect
        .poll(
          async () => {
            const response = await fetch(
              `http://127.0.0.1:${port}/api/health`,
              {
                signal: AbortSignal.timeout(500),
                headers: { connection: "close" },
              },
            );
            return response.status;
          },
          { timeout: 8000 },
        )
        .toBe(200);
      api.child.kill("SIGTERM");
      await waitForExit(api);
      expect(worker.child.exitCode).toBeNull();
      expect(worker.child.signalCode).toBeNull();
    }
    worker.child.kill("SIGTERM");
    await waitForExit(worker);
  });

  it.each(["adminUrl", "migrationUrl"] as const)(
    "closes resources after refusing %s",
    async (key) => {
      const worker = fixture.start([], fixture.postgres[key]);
      expect(await worker.done).toMatchObject({
        message: "Database connection requires anar_app",
      });
      expect(await fixture.activeConnections()).toBe(0);
      expect((await beats()).rows).toEqual([]);
    },
  );

  it("closes the worker after handler registration fails", async () => {
    const worker = fixture.start([{ name: "", async run() {} }]);
    const result = await worker.done;
    expect(result).toBeInstanceOf(Error);
    expect(await fixture.activeConnections()).toBe(0);
    expect((await beats()).rows).toEqual([]);
  });

  it("stops the worker after its queue fetch fails", async () => {
    const worker = fixture.start([
      { name: "s12b-missing-queue", async run() {} },
    ]);
    expect(await worker.done).toBeInstanceOf(Error);
    expect(await fixture.activeConnections()).toBe(0);
  });

  it("aborts startup within a bound when heartbeat is locked", async () => {
    const lock = await fixture.owner.connect();
    let finished = false;
    let result: unknown;
    try {
      await lock.query("begin");
      await lock.query("lock table worker_heartbeats in access exclusive mode");
      const worker = fixture.start();
      void worker.done.then((value) => {
        result = value;
        finished = true;
      });
      await expect
        .poll(
          async () =>
            (
              await fixture.admin.query(`select count(*)::int as count
        from pg_stat_activity where datname = current_database() and usename = 'anar_app'
        and wait_event_type = 'Lock' and query like 'insert into public.worker_heartbeats%'`)
            ).rows[0].count,
          { timeout: 8000 },
        )
        .toBe(1);
      worker.controller.abort();
      await expect.poll(() => finished, { timeout: 18000 }).toBe(true);
      expect(result).toBeInstanceOf(Error);
      expect(await fixture.activeConnections()).toBe(0);
    } finally {
      await lock.query("rollback");
      lock.release();
    }
  });

  it("stops on a failed periodic heartbeat and closes its pool", async () => {
    const worker = fixture.start();
    await expect.poll(async () => (await beats()).rowCount).toBe(1);
    let finished = false;
    let result: unknown;
    void worker.done.then((value) => {
      result = value;
      finished = true;
    });
    await fixture.owner.query(
      "alter table worker_heartbeats rename to unavailable_heartbeat",
    );
    try {
      await expect
        .poll(() => finished, { timeout: 38000, interval: 100 })
        .toBe(true);
      expect(result).toMatchObject({ message: "Worker queue failed" });
      expect(await fixture.activeConnections()).toBe(0);
    } finally {
      await fixture.owner.query(
        "alter table unavailable_heartbeat rename to worker_heartbeats",
      );
    }
  });

  it("bounds shutdown when a handler waits for its aborted signal", async () => {
    const name = await fixture.createQueue();
    const entered = Promise.withResolvers<void>();
    const worker = fixture.start([
      {
        name,
        async run(job) {
          entered.resolve();
          await new Promise<void>((_, reject) =>
            job.signal.addEventListener(
              "abort",
              () => reject(new Error("Synthetic handler stopped")),
              { once: true },
            ),
          );
        },
      },
    ]);
    const id = await fixture.publish(name, { fixture: true });
    await entered.promise;
    worker.controller.abort();
    let finished = false;
    void worker.done.then(() => {
      finished = true;
    });
    await expect
      .poll(() => finished, { timeout: 22000, interval: 100 })
      .toBe(true);
    expect(await worker.done).toBeUndefined();
    expect((await fixture.queue.findJobs(name, { id }))[0]).toMatchObject({
      state: "retry",
    });
    expect(await fixture.activeConnections()).toBe(0);
  });
});
