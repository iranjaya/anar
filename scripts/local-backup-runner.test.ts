import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { validateArchive } from "./backup/archive.ts";
import { listTar } from "./backup/tar.ts";
import { type BackupIO, createBackupRunner } from "./local-backup-runner.ts";

const exec = promisify(execFile);

test("runner coordinates only the named project and preserves its running state", async () => {
  const calls: string[][] = [];
  const io: BackupIO = {
    async docker(args) {
      calls.push(args);
      if (args.includes("ps")) return "db\nweb\napi\nworker\nproxy\n";
      if (args.includes("volume")) return "source_uploads_data\n";
      const query = args.at(-1) ?? "";
      if (query.includes("__drizzle_migrations")) return "abc123\n";
      if (query.includes("json_build_object"))
        return '{"leads":2,"follow_ups":1}\n';
      return "";
    },
    async dockerToFile(args) {
      calls.push(args);
    },
    async revision() {
      return "a".repeat(40);
    },
  };
  const runner = createBackupRunner("/synthetic/anar", io);
  const state = await runner.runningState("anar-source");
  await runner.quiesce("anar-source", new AbortController().signal);
  assert.deepEqual(await runner.metadata("anar-source"), {
    sourceRevision: "a".repeat(40),
    schemaVersion: "abc123",
    rowCounts: { leads: 2, follow_ups: 1 },
  });
  await runner.dump(
    "anar-source",
    "/synthetic/database.dump",
    new AbortController().signal,
  );
  await runner.archiveUploads(
    "anar-source",
    "/synthetic/uploads.tar",
    new AbortController().signal,
  );
  await runner.verifyDump("/synthetic/database.dump");
  await runner.resume("anar-source", state);

  const composeCalls = calls.filter((args) => args[0] === "compose");
  assert.ok(
    composeCalls.every(
      (args) =>
        args.includes("anar-source") &&
        args.includes("/synthetic/anar/.env") &&
        !args.includes("migrate"),
    ),
  );
  assert.deepEqual(
    composeCalls
      .filter((args) => args.includes("stop"))
      .map((args) => args.slice(-2)),
    [
      ["60", "proxy"],
      ["api", "worker"],
    ],
  );
  assert.deepEqual(composeCalls.at(-1)?.slice(-4), [
    "start",
    "api",
    "worker",
    "proxy",
  ]);
  const dump = calls.find((args) =>
    args.some((arg) => arg.includes("pg_dump")),
  );
  assert.ok(
    dump?.some((arg) => arg.includes("--format=custom --no-owner --no-acl")),
  );
  const archive = calls.find((args) => args.includes("--format=ustar"));
  assert.ok(archive?.includes("--read-only"));
  assert.ok(archive?.some((arg) => arg.endsWith("target=/uploads,readonly")));
  assert.ok(
    calls.some(
      (args) => args.includes("pg_restore") && args.includes("--list"),
    ),
  );
  assert.ok(
    !calls.some((args) => args.includes("down") || args.includes("--volumes")),
  );
});

test("project lock blocks a second runner until the first completes", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "anar-backup-lock-test-"),
  );
  const io: BackupIO = {
    docker: async () => "",
    dockerToFile: async () => {},
    revision: async () => "a".repeat(40),
  };
  const first = createBackupRunner(directory, io, directory);
  const second = createBackupRunner(directory, io, directory);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const active = first.withSourceLock("anar-source", () => {
    entered();
    return held;
  });
  await started;
  await assert.rejects(
    second.withSourceLock("anar-source", async () => {}),
    /already locked/,
  );
  release();
  await active;
  await second.withSourceLock("anar-source", async () => {});
});

test("ustar listing detects links before a backup can publish", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "anar-backup-tar-test-"));
  const uploads = path.join(directory, "uploads");
  await mkdir(uploads);
  await writeFile(path.join(uploads, "import.csv"), "synthetic\n");
  const archive = path.join(directory, "uploads.tar");
  await exec("tar", ["--format=ustar", "-cf", archive, "-C", uploads, "."]);
  validateArchive(await listTar(archive));
  await symlink("import.csv", path.join(uploads, "alias.csv"));
  await exec("tar", ["--format=ustar", "-cf", archive, "-C", uploads, "."]);
  const entries = await listTar(archive);
  assert.throws(() => validateArchive(entries), /Unsafe uploads archive/);
  await appendFile(archive, Buffer.alloc(512, 1));
  await assert.rejects(listTar(archive), /Invalid uploads archive/);
});
