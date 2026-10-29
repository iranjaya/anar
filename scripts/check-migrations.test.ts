import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkMigrations,
  migrationDrift,
  migrationFiles,
} from "./check-migrations.ts";

function schemaFixture(schema: string, run: (root: string) => void) {
  const repo = fileURLToPath(new URL("../", import.meta.url));
  const root = mkdtempSync(path.join(tmpdir(), "anar-schema-"));
  try {
    mkdirSync(path.join(root, "packages/db/src/schema"), { recursive: true });
    for (const file of [
      "package.json",
      "pnpm-workspace.yaml",
      "packages/db/package.json",
      "packages/db/drizzle.config.ts",
    ])
      copyFileSync(path.join(repo, file), path.join(root, file));
    symlinkSync(path.join(repo, ".git"), path.join(root, ".git"));
    symlinkSync(
      path.join(repo, "packages/db/node_modules"),
      path.join(root, "packages/db/node_modules"),
    );
    writeFileSync(path.join(root, "packages/db/src/schema/index.ts"), schema);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("generates the empty S0 schema in scratch storage", () => {
  schemaFixture("export {};", (root) =>
    assert.doesNotThrow(() => checkMigrations(root)),
  );
});
test("fails when a table has no committed migration", () => {
  schemaFixture(
    'import { pgTable, text } from "drizzle-orm/pg-core"; export const fixture = pgTable("fixture", { id: text("id") });',
    (root) => assert.throws(() => checkMigrations(root), /Migration drift/),
  );
});
test("fails on a broken schema even when Drizzle exits zero", () => {
  schemaFixture('throw new Error("broken schema");', (root) =>
    assert.throws(() => checkMigrations(root)),
  );
});

test("accepts the empty S0 history", () => {
  assert.deepEqual(migrationDrift(new Map(), new Map()), []);
});
test("detects changed SQL and metadata, including extra files", () => {
  const history = new Map([
    ["0000.sql", "create table a"],
    ["meta/_journal.json", "original"],
  ]);
  const changed = new Map([
    ["0000.sql", "create table b"],
    ["meta/_journal.json", "changed"],
    ["meta/0001_snapshot.json", "untracked"],
  ]);
  assert.deepEqual(migrationDrift(history, changed), [
    "0000.sql",
    "meta/0001_snapshot.json",
    "meta/_journal.json",
  ]);
  assert.deepEqual(migrationDrift(history, new Map()), [
    "0000.sql",
    "meta/_journal.json",
  ]);
});
test("reads untracked files instead of relying on git diff", () => {
  const root = mkdtempSync(path.join(tmpdir(), "anar-migrations-"));
  try {
    mkdirSync(path.join(root, "meta"));
    writeFileSync(path.join(root, "extra.sql"), "select 1;");
    writeFileSync(path.join(root, "meta/extra.json"), "{}");
    assert.deepEqual(migrationDrift(new Map(), migrationFiles(root)), [
      "extra.sql",
      "meta/extra.json",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
