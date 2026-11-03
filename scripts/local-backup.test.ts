import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateArchive } from "./backup/archive.ts";
import { parseManifest, verifyBackup } from "./backup/manifest.ts";
import { type BackupRunner, backupLocal } from "./local-backup.ts";

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "anar-backup-proof-"));
  const repository = path.join(root, "repo");
  const output = path.join(root, "backups");
  await mkdir(repository);
  await mkdir(output);
  const calls: string[] = [];
  const controller = new AbortController();
  const runner: BackupRunner<string[]> = {
    async withSourceLock(_project, operation) {
      calls.push("lock");
      try {
        return await operation();
      } finally {
        calls.push("unlock");
      }
    },
    async runningState() {
      return ["api", "worker", "proxy"];
    },
    async quiesce() {
      calls.push("stop");
    },
    async resume(_project, state) {
      assert.deepEqual(state, ["api", "worker", "proxy"]);
      calls.push("restart");
    },
    async metadata() {
      return {
        sourceRevision: "a".repeat(40),
        schemaVersion: "0000_initial",
        rowCounts: { leads: 2, import_rows: 500 },
      };
    },
    async dump(_project, file) {
      calls.push("dump");
      await writeFile(file, "synthetic dump");
    },
    async archiveUploads(_project, file) {
      calls.push("archive");
      await writeFile(file, "synthetic archive");
    },
    async verifyDump() {
      calls.push("verify dump");
    },
    async listArchive() {
      return [{ name: "pending/file.csv", kind: "file" }];
    },
  };
  const input = {
    repository,
    output,
    project: "anar-proof",
    signal: controller.signal,
    now: () => new Date("2026-11-02T02:00:00Z"),
    runner,
  };
  return { input, calls, runner, controller, output };
}

test("publishes verified private artifacts and restarts before releasing the lock", async () => {
  const c = await setup();
  const saved = await backupLocal(c.input);
  assert.deepEqual(await verifyBackup(saved.directory), saved.manifest);
  assert.equal((await stat(saved.directory)).mode & 0o777, 0o700);
  for (const name of ["database.dump", "uploads.tar", "manifest.json"])
    assert.equal(
      (await stat(path.join(saved.directory, name))).mode & 0o777,
      0o600,
    );
  assert.deepEqual(c.calls, [
    "lock",
    "stop",
    "dump",
    "archive",
    "verify dump",
    "restart",
    "unlock",
  ]);
});

for (const [method, label] of [
  ["quiesce", "quiesce"],
  ["metadata", "metadata"],
  ["dump", "database dump"],
  ["archiveUploads", "uploads archive"],
  ["verifyDump", "verify dump"],
  ["listArchive", "verify archive"],
  ["resume", "source restart"],
] as const) {
  test(`keeps the cause and a safe step message when ${method} fails`, async () => {
    const c = await setup();
    const cause = new Error("password=synthetic-secret-canary");
    c.runner[method] = async () => {
      throw cause;
    };
    await assert.rejects(backupLocal(c.input), (error: Error) => {
      assert.ok(error.message.includes(label));
      assert.equal(error.message.includes("synthetic-secret-canary"), false);
      assert.equal(error.cause, cause);
      return true;
    });
    if (method !== "resume") assert.ok(c.calls.includes("restart"));
    assert.equal(c.calls.at(-1), "unlock");
  });
}

test("an interrupted dump restarts the source and preserves the previous backup", async () => {
  const c = await setup();
  const good = await backupLocal(c.input);
  const manifest = await readFile(
    path.join(good.directory, "manifest.json"),
    "utf8",
  );
  c.runner.dump = async () => {
    c.controller.abort();
    c.controller.signal.throwIfAborted();
  };
  await assert.rejects(backupLocal(c.input), /database dump/);
  assert.equal(
    await readFile(path.join(good.directory, "manifest.json"), "utf8"),
    manifest,
  );
  assert.equal((await readdir(c.output)).length, 2);
  assert.deepEqual(await verifyBackup(good.directory), good.manifest);
  assert.equal(c.calls.at(-2), "restart");
});

test("refuses output inside the repository before stopping the source", async () => {
  const c = await setup();
  await assert.rejects(backupLocal({ ...c.input, output: c.input.repository }));
  assert.equal(c.calls.includes("stop"), false);
});

test("keeps lock and state errors out of the operator message", async () => {
  for (const method of ["withSourceLock", "runningState"] as const) {
    const c = await setup();
    const cause = new Error("password=synthetic-secret-canary");
    c.runner[method] = async () => {
      throw cause;
    };
    await assert.rejects(backupLocal(c.input), (error: Error) => {
      assert.equal(error.message.includes("synthetic-secret-canary"), false);
      assert.equal(error.cause, cause);
      return true;
    });
    assert.equal(c.calls.includes("stop"), false);
  }
});

test("rejects corrupt artifacts and incomplete manifests", async () => {
  const c = await setup();
  const saved = await backupLocal(c.input);
  await writeFile(path.join(saved.directory, "uploads.tar"), "corrupt");
  await assert.rejects(verifyBackup(saved.directory), /checksum/);
  assert.throws(() =>
    parseManifest({ ...saved.manifest, rowCounts: { leads: -1 } }),
  );
  assert.throws(() => parseManifest({ ...saved.manifest, password: "canary" }));
});

test("rejects traversal, links and duplicate archive paths", () => {
  for (const name of [
    "../outside",
    "/outside",
    "C:/outside",
    "a/../../outside",
    "a\\outside",
  ])
    assert.throws(() => validateArchive([{ name, kind: "file" }]));
  assert.throws(() => validateArchive([{ name: "link", kind: "link" }]));
  assert.throws(() =>
    validateArchive([
      { name: "a", kind: "file" },
      { name: "./a", kind: "file" },
    ]),
  );
  validateArchive([
    { name: ".", kind: "directory" },
    { name: "pending/file.csv", kind: "file" },
  ]);
});
