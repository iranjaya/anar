import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type BackupManifest, checksum } from "./backup/manifest.ts";
import {
  agentPlist,
  installBackupAgent,
  readLastSuccess,
  runBackupTick,
} from "./local-backup-schedule.ts";

const zone = "Asia/Kathmandu";
const project = "anar-proof-schedule";

test("launch catch-up records only a verified success and does not prune", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "anar-backup-schedule-"));
  let calls = 0;
  const backup = async (input: { output: string }) => {
    calls++;
    const directory = path.join(input.output, `backup-${calls}`);
    await mkdir(directory);
    await writeFile(
      path.join(directory, "database.dump"),
      "synthetic database",
    );
    await writeFile(path.join(directory, "uploads.tar"), "synthetic uploads");
    const manifest: BackupManifest = {
      format: 1,
      createdAt: new Date(`2026-11-0${calls + 1}T00:00:00.000Z`).toISOString(),
      sourceRevision: "a".repeat(40),
      schemaVersion: "schema1",
      databaseSha256: await checksum(path.join(directory, "database.dump")),
      uploadsSha256: await checksum(path.join(directory, "uploads.tar")),
      rowCounts: { leads: 0 },
    };
    await writeFile(
      path.join(directory, "manifest.json"),
      JSON.stringify(manifest),
    );
    return { directory, manifest };
  };
  const tick = (now: string) =>
    runBackupTick({
      project,
      repository: "/synthetic/anar",
      root,
      now: new Date(now),
      timezone: zone,
      signal: new AbortController().signal,
      backup,
    });
  assert.deepEqual(await tick("2026-11-02T00:00:00Z"), {
    ran: true,
    overdue: false,
    retentionCandidates: 0,
  });
  assert.equal(
    await readLastSuccess(root, project),
    "2026-11-02T00:00:00.000Z",
  );
  assert.deepEqual(await tick("2026-11-02T01:00:00Z"), {
    ran: false,
    overdue: false,
    retentionCandidates: 0,
  });
  assert.equal(calls, 1);
  const before = await readFile(
    path.join(root, "backup-status", `${project}.jsonl`),
    "utf8",
  );
  await assert.rejects(
    runBackupTick({
      project,
      repository: "/synthetic/anar",
      root,
      now: new Date("2026-11-03T20:15:00Z"),
      timezone: zone,
      signal: new AbortController().signal,
      backup: async () => {
        throw new Error("synthetic failure");
      },
    }),
  );
  assert.equal(
    await readFile(
      path.join(root, "backup-status", `${project}.jsonl`),
      "utf8",
    ),
    before,
  );
});

test("LaunchAgent uses 02:00 and runs catch-up on load", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "anar-backup-agent-"));
  const calls: string[][] = [];
  await installBackupAgent(project, home, async (args) => {
    calls.push(args);
  });
  const plist = await readFile(
    path.join(
      home,
      "Library",
      "LaunchAgents",
      `com.anar.local-backup.${project}.plist`,
    ),
    "utf8",
  );
  assert.equal(
    plist,
    agentPlist(
      project,
      process.execPath,
      new URL("./local-backup-schedule.ts", import.meta.url).pathname,
    ),
  );
  assert.match(plist, /<key>Hour<\/key><integer>2<\/integer>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.deepEqual(
    calls.map((args) => args[0]),
    ["bootout", "bootstrap"],
  );
});
