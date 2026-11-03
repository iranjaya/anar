import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { readImportJobState } from "@anar/api/jobs";
import { PgBoss } from "pg-boss";
import { v7 } from "uuid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startFixture, type WorkerFixture } from "./support/fixture.js";

describe("import jobs survive a killed worker", () => {
  let fixture: WorkerFixture;
  let supervisor: PgBoss;
  const children: ChildProcess[] = [];
  beforeAll(async () => {
    fixture = await startFixture();
    supervisor = new PgBoss({
      connectionString: fixture.postgres.appUrl,
      migrate: false,
      createSchema: false,
      schedule: false,
      reindex: false,
      persistQueueStats: false,
      supervise: true,
      superviseIntervalSeconds: 1,
      monitorIntervalSeconds: 1,
    });
    await supervisor.start();
  });
  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  });
  afterAll(async () => {
    await supervisor?.stop({ graceful: false });
    await fixture?.close();
  });

  const state = (jobId: string) =>
    fixture.db.transaction((tx) => readImportJobState(tx, jobId));
  async function worker(mode: "hang" | "finish") {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL("./support/importQueueWorker.mjs", import.meta.url),
        ),
      ],
      {
        env: { ...process.env, ...fixture.env, IMPORT_JOB: mode },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    children.push(child);
    await once(child.stdout, "data");
    return child;
  }
  async function kill(child: ChildProcess) {
    const closed = once(child, "close");
    child.kill("SIGKILL");
    await closed;
  }
  const send = () =>
    fixture.queue.send(
      "import.commit",
      { runId: v7() },
      {
        singletonKey: `import:${v7()}:${v7()}:${v7()}`,
        expireInSeconds: 2,
        retryDelay: 1,
        retryBackoff: false,
      },
    );

  it("retries after each death and fails after the third delivery dies", async () => {
    const jobId = await send();
    if (!jobId) throw new Error("Expected a queued job");
    expect(await state(jobId)).toEqual({ state: "queued", attempts: 0 });
    for (const attempt of [1, 2, 3]) {
      const child = await worker("hang");
      await expect
        .poll(() => state(jobId), { timeout: 20000, interval: 250 })
        .toEqual({ state: "active", attempts: attempt });
      await kill(child);
      await expect
        .poll(() => state(jobId), { timeout: 20000, interval: 250 })
        .toEqual({
          state: attempt < 3 ? "retrying" : "failed",
          attempts: attempt,
        });
    }
  });

  it("reports a finished job as completed", async () => {
    const jobId = await send();
    if (!jobId) throw new Error("Expected a queued job");
    await worker("finish");
    await expect
      .poll(() => state(jobId), { timeout: 20000, interval: 250 })
      .toEqual({ state: "completed", attempts: 1 });
  });

  it("reports an unknown job as missing", async () => {
    expect(await state(v7())).toEqual({ state: "missing", attempts: 0 });
  });
});
