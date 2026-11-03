import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checksum } from "./backup/manifest.ts";
import {
  backupSchedule,
  inspectRetention,
  retentionCandidates,
} from "./backup/retention.ts";

test("keeps seven daily and four weekly sets with overlap", () => {
  const newest = Date.parse("2026-11-02T12:00:00Z");
  const sets = Array.from({ length: 35 }, (_, day) => ({
    directory: `day-${day}`,
    createdAt: new Date(newest - day * 86_400_000).toISOString(),
  }));
  const candidates = new Set(retentionCandidates(sets, "UTC"));
  assert.deepEqual(
    sets
      .filter((set) => !candidates.has(set.directory))
      .map((set) => set.directory),
    [
      "day-0",
      "day-1",
      "day-2",
      "day-3",
      "day-4",
      "day-5",
      "day-6",
      "day-8",
      "day-15",
    ],
  );
});

test("same-day duplicates keep the newest and use directory order for ties", () => {
  const sets = [
    { directory: "old", createdAt: "2026-11-02T03:00:00Z" },
    { directory: "b", createdAt: "2026-11-02T04:00:00Z" },
    { directory: "a", createdAt: "2026-11-02T04:00:00Z" },
  ];
  assert.deepEqual(retentionCandidates(sets, "UTC"), ["b", "old"]);
  assert.deepEqual(retentionCandidates([], "UTC"), []);
});

test("retention uses company local dates", () => {
  const sets = [
    { directory: "before", createdAt: "2026-11-01T18:00:00Z" },
    { directory: "after", createdAt: "2026-11-01T19:00:00Z" },
  ];
  assert.deepEqual(retentionCandidates(sets, "Asia/Kathmandu"), []);
  assert.deepEqual(retentionCandidates(sets, "UTC"), ["before"]);
});

test("schedule catches up at 02:00 local and warns at 24 hours", () => {
  const zone = "Asia/Kathmandu";
  const last = "2026-11-01T20:16:00Z";
  assert.deepEqual(
    backupSchedule(new Date("2026-11-02T20:14:59Z"), zone, last),
    { due: false, overdue: false },
  );
  assert.deepEqual(
    backupSchedule(new Date("2026-11-02T20:15:00Z"), zone, last),
    { due: true, overdue: false },
  );
  assert.deepEqual(
    backupSchedule(new Date("2026-11-02T20:16:00Z"), zone, last),
    { due: true, overdue: true },
  );
  assert.deepEqual(
    backupSchedule(
      new Date("2026-11-02T22:00:00Z"),
      zone,
      "2026-11-02T21:00:00Z",
    ),
    { due: false, overdue: false },
  );
  for (const missing of [null, "invalid", "2099-01-01T00:00:00Z"])
    assert.deepEqual(
      backupSchedule(new Date("2026-11-02T00:00:00Z"), zone, missing),
      { due: true, overdue: true },
    );
});

test("DST fallback does not schedule twice after a successful backup", () => {
  assert.deepEqual(
    backupSchedule(
      new Date("2026-11-01T07:30:00Z"),
      "America/New_York",
      "2026-11-01T06:30:00Z",
    ),
    { due: false, overdue: false },
  );
});

test("retention verifies sets and preserves every directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "anar-retention-proof-"));
  const complete = async (name: string, createdAt: string) => {
    const directory = path.join(root, name);
    await mkdir(directory, { mode: 0o700 });
    for (const file of ["database.dump", "uploads.tar"])
      await writeFile(path.join(directory, file), "synthetic", { mode: 0o600 });
    await writeFile(
      path.join(directory, "manifest.json"),
      JSON.stringify({
        format: 1,
        createdAt,
        sourceRevision: "a".repeat(40),
        schemaVersion: "0000_initial",
        databaseSha256: await checksum(path.join(directory, "database.dump")),
        uploadsSha256: await checksum(path.join(directory, "uploads.tar")),
        rowCounts: { leads: 1 },
      }),
      { mode: 0o600 },
    );
    return directory;
  };
  const good = await complete("backup-new", "2026-11-02T03:00:00Z");
  const old = await complete("backup-old", "2026-11-02T02:00:00Z");
  await mkdir(path.join(root, "backup-incomplete"));
  const before = await readdir(root);
  assert.deepEqual(await inspectRetention(root, good, "UTC"), {
    candidates: [old],
    incomplete: 1,
  });
  assert.deepEqual(await readdir(root), before);
  await assert.rejects(
    inspectRetention(root, path.join(root, "backup-incomplete"), "UTC"),
  );
  assert.deepEqual(await readdir(root), before);
});
