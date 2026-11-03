import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type BackupManifest, checksum } from "./backup/manifest.ts";
import { type RestoreRunner, restoreLocal } from "./local-restore.ts";

async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "anar-restore-proof-"));
  await writeFile(path.join(directory, "database.dump"), "synthetic database", {
    mode: 0o600,
  });
  await writeFile(
    path.join(directory, "uploads.tar"),
    "synthetic pending import",
    { mode: 0o600 },
  );
  const manifest: BackupManifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    sourceRevision: "a".repeat(40),
    schemaVersion: "0000_initial",
    databaseSha256: await checksum(path.join(directory, "database.dump")),
    uploadsSha256: await checksum(path.join(directory, "uploads.tar")),
    rowCounts: { leads: 2, import_rows: 500 },
  };
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest),
    { mode: 0o600 },
  );
  const calls: string[] = [];
  let snapshot = "";
  const runner: RestoreRunner = {
    async withTargetLock(_project, operation) {
      return operation();
    },
    async verifyDump(file) {
      snapshot = path.dirname(file);
      calls.push("dump check");
    },
    async listArchive() {
      calls.push("archive check");
      return [{ name: "pending/file.csv", kind: "file" }];
    },
    async reserveEmptyTarget() {
      calls.push("reserve");
    },
    async bootstrapRoles() {
      calls.push("roles");
    },
    async restoreDatabase(_project, file, options) {
      assert.equal(await readFile(file, "utf8"), "synthetic database");
      assert.deepEqual(options, {
        role: "anar_migrate",
        noOwner: true,
        noAcl: true,
      });
      calls.push("restore");
    },
    async applyRuntimeGrants() {
      calls.push("grants");
    },
    async extractUploads(_project, file) {
      assert.equal(await readFile(file, "utf8"), "synthetic pending import");
      calls.push("uploads");
    },
    async readRowCounts() {
      calls.push("counts");
      return manifest.rowCounts;
    },
    async verifyRelationshipsAndStoredState() {
      calls.push("relationships");
    },
    async verifyRestrictedAccess() {
      calls.push("access");
    },
    async startIsolated(_project, options) {
      assert.deepEqual(options, { email: "fake", push: "disabled" });
      calls.push("start");
    },
    async markVerified() {
      calls.push("verified");
    },
  };
  const input = {
    directory,
    project: "anar-restore-proof",
    signal: new AbortController().signal,
    runner,
  };
  return { input, runner, calls, manifest, snapshot: () => snapshot };
}

test("restores verified private copies and removes only its snapshot", async () => {
  const c = await setup();
  const verifyDump = c.runner.verifyDump;
  c.runner.verifyDump = async (file) => {
    await verifyDump(file);
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
    await writeFile(
      path.join(c.input.directory, "uploads.tar"),
      "source changed",
    );
  };
  assert.deepEqual(await restoreLocal(c.input), c.manifest);
  assert.deepEqual(c.calls, [
    "dump check",
    "archive check",
    "reserve",
    "roles",
    "restore",
    "grants",
    "uploads",
    "counts",
    "relationships",
    "access",
    "start",
    "verified",
  ]);
  await assert.rejects(stat(c.snapshot()), { code: "ENOENT" });
  assert.equal(
    await readFile(path.join(c.input.directory, "uploads.tar"), "utf8"),
    "source changed",
  );
});

for (const method of [
  "reserveEmptyTarget",
  "bootstrapRoles",
  "restoreDatabase",
  "applyRuntimeGrants",
  "extractUploads",
  "verifyRelationshipsAndStoredState",
  "verifyRestrictedAccess",
  "startIsolated",
] as const) {
  test(`keeps the target unverified and removes its snapshot when ${method} fails`, async () => {
    const c = await setup();
    const cause = new Error("password=synthetic-secret-canary");
    c.runner[method] = async () => {
      throw cause;
    };
    await assert.rejects(restoreLocal(c.input), (error: Error) => {
      assert.equal(error.cause, cause);
      assert.equal(error.message.includes("synthetic-secret-canary"), false);
      return true;
    });
    assert.equal(c.calls.includes("verified"), false);
    await assert.rejects(stat(c.snapshot()), { code: "ENOENT" });
    assert.ok(await stat(c.input.directory));
  });
}

test("refuses a wrong project, corruption or traversal before reserving a target", async () => {
  const c = await setup();
  await assert.rejects(restoreLocal({ ...c.input, project: "anar-local" }));
  assert.equal(c.calls.length, 0);
  c.runner.listArchive = async () => [{ name: "../outside", kind: "file" }];
  await assert.rejects(restoreLocal(c.input), /archive verification/);
  await assert.rejects(stat(c.snapshot()), { code: "ENOENT" });
  await writeFile(path.join(c.input.directory, "database.dump"), "corrupt");
  await assert.rejects(restoreLocal(c.input), /backup verification/);
  assert.equal(c.calls.includes("reserve"), false);
});

test("count mismatch prevents startup and completion", async () => {
  const c = await setup();
  c.runner.readRowCounts = async () => ({ leads: 1, import_rows: 500 });
  await assert.rejects(restoreLocal(c.input), /row counts/);
  assert.equal(c.calls.includes("start"), false);
  assert.equal(c.calls.includes("verified"), false);
  await assert.rejects(stat(c.snapshot()), { code: "ENOENT" });
});

test("cancellation preserves the target and removes the private snapshot", async () => {
  const c = await setup();
  const controller = new AbortController();
  c.runner.bootstrapRoles = async () => {
    controller.abort();
  };
  await assert.rejects(restoreLocal({ ...c.input, signal: controller.signal }));
  assert.equal(c.calls.includes("start"), false);
  await assert.rejects(stat(c.snapshot()), { code: "ENOENT" });
});
