import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { backupLocal } from "./local-backup.ts";
import { type BackupIO, createBackupRunner } from "./local-backup-runner.ts";
import {
  type RecoveryDrillRunner,
  runRecoveryDrill,
} from "./recovery-drill.ts";

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "anar-drill-proof-"));
  const repository = path.join(root, "repo");
  const backupOutput = path.join(root, "backups");
  await mkdir(repository);
  await mkdir(backupOutput);
  let workerRunning = false;
  let reportWorkerRunning = false;
  const commands: string[][] = [];
  const calls: string[] = [];
  const io: BackupIO = {
    async docker(args) {
      commands.push(args);
      if (args.includes("ps"))
        return `db\napi\nproxy\n${reportWorkerRunning ? "worker\n" : ""}`;
      if (args.includes("stop") && args.includes("worker"))
        workerRunning = false;
      if (args.includes("start") && args.includes("worker"))
        workerRunning = true;
      return "";
    },
    async dockerToFile() {},
    async revision() {
      return "a".repeat(40);
    },
  };
  const runtime = createBackupRunner(repository, io, root);
  let clock = 100;
  const runner: RecoveryDrillRunner = {
    async assertDisposable() {},
    async preparePausedImport() {
      calls.push("paused500");
      workerRunning = false;
      return { processed: 500, totalRows: 501 };
    },
    async sourceState() {
      assert.equal(workerRunning, false, "Source worker must remain stopped");
      calls.push("source state");
      return { databaseSha256: "a".repeat(64), uploadsSha256: "b".repeat(64) };
    },
    async backup(project, output) {
      const saved = await backupLocal({
        repository,
        output,
        project,
        signal: new AbortController().signal,
        now: () => new Date("2026-11-02T02:00:00Z"),
        runner: {
          ...runtime,
          async metadata() {
            return {
              sourceRevision: "a".repeat(40),
              schemaVersion: "0000_initial",
              rowCounts: { import_rows: 500 },
            };
          },
          async dump(_project, file) {
            await writeFile(file, "synthetic database");
          },
          async archiveUploads(_project, file) {
            await writeFile(file, "synthetic pending import");
          },
          async verifyDump() {},
          async listArchive() {
            return [{ name: "pending/import.csv", kind: "file" }];
          },
        },
      });
      calls.push("backup complete");
      return saved;
    },
    async restore(_directory, project) {
      assert.equal(project, "anar-restore-drill");
      calls.push("restore");
    },
    async resumeImport(project) {
      assert.equal(project, "anar-restore-drill");
      calls.push("resume target");
      return { ledgerRows: 501, distinctRowNumbers: 501, importedEvents: 501 };
    },
    async checkBrowser(_project, width) {
      calls.push(width);
    },
    async stopDisposableContainers(project) {
      calls.push(`stop ${project}`);
    },
  };
  const input = {
    sourceProject: "anar-proof-drill",
    targetProject: "anar-restore-drill",
    backupOutput,
    browserOutput: path.join(root, "browser"),
    runner,
    monotonicMs: () => {
      clock += 100;
      return clock;
    },
  };
  return {
    input,
    runner,
    calls,
    commands,
    workerRunning: () => workerRunning,
    misreportWorker: () => {
      reportWorkerRunning = true;
    },
  };
}

test("backup preserves the stopped source worker through the final checksum check", async () => {
  const c = await setup();
  assert.deepEqual(await runRecoveryDrill(c.input), {
    restoreMs: 100,
    browserWidths: ["phone", "desktop"],
    totalRows: 501,
  });
  const starts = c.commands.filter((args) => args.includes("start"));
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0].slice(-3), ["start", "api", "proxy"]);
  assert.equal(starts[0].includes("worker"), false);
  assert.equal(c.workerRunning(), false);
  assert.deepEqual(c.calls, [
    "paused500",
    "source state",
    "backup complete",
    "restore",
    "resume target",
    "phone",
    "desktop",
    "source state",
    "stop anar-restore-drill",
    "stop anar-proof-drill",
  ]);
});

test("the unchanged-source check fails if backup restarts the source worker", async () => {
  const c = await setup();
  c.misreportWorker();
  await assert.rejects(runRecoveryDrill(c.input), /source unchanged/);
  assert.equal(c.workerRunning(), true);
});

for (const method of [
  "preparePausedImport",
  "backup",
  "restore",
  "resumeImport",
  "checkBrowser",
] as const) {
  test(`stops both disposable stacks after ${method} fails`, async () => {
    const c = await setup();
    const cause = new Error("password=synthetic-secret-canary");
    c.runner[method] = async () => {
      throw cause;
    };
    await assert.rejects(runRecoveryDrill(c.input), (error: Error) => {
      assert.equal(error.cause, cause);
      assert.equal(error.message.includes("synthetic-secret-canary"), false);
      return true;
    });
    assert.deepEqual(c.calls.slice(-2), [
      "stop anar-restore-drill",
      "stop anar-proof-drill",
    ]);
  });
}

test("duplicate ledger rows or events fail recovery", async () => {
  for (const counts of [
    { ledgerRows: 502, distinctRowNumbers: 501, importedEvents: 501 },
    { ledgerRows: 501, distinctRowNumbers: 500, importedEvents: 501 },
    { ledgerRows: 501, distinctRowNumbers: 501, importedEvents: 502 },
  ]) {
    const c = await setup();
    c.runner.resumeImport = async () => counts;
    await assert.rejects(runRecoveryDrill(c.input), /resume pending import/);
    assert.equal(c.calls.includes("phone"), false);
  }
});

test("recovery over 60 minutes fails before browser checks", async () => {
  const c = await setup();
  let clock = 0;
  await assert.rejects(
    runRecoveryDrill({
      ...c.input,
      monotonicMs: () => {
        clock += 3_600_001;
        return clock;
      },
    }),
    /resume pending import/,
  );
  assert.equal(c.calls.includes("phone"), false);
});

test("checksum differences fail the unchanged-source check", async () => {
  const c = await setup();
  let reads = 0;
  c.runner.sourceState = async () => ({
    databaseSha256: `${reads++}`,
    uploadsSha256: "same",
  });
  await assert.rejects(runRecoveryDrill(c.input), /source unchanged/);
});

test("cleanup still attempts the source when target cleanup fails", async () => {
  const c = await setup();
  c.runner.stopDisposableContainers = async (project) => {
    c.calls.push(project);
    if (project === c.input.targetProject)
      throw new Error("cannot stop target");
  };
  await assert.rejects(runRecoveryDrill(c.input), /container cleanup/);
  assert.deepEqual(c.calls.slice(-2), [
    c.input.targetProject,
    c.input.sourceProject,
  ]);
});

test("refuses real project names before any runner call", async () => {
  const c = await setup();
  await assert.rejects(
    runRecoveryDrill({ ...c.input, sourceProject: "anar-local" }),
  );
  assert.equal(c.calls.length, 0);
});
