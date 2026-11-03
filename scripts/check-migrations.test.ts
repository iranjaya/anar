import assert from "node:assert/strict";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyInitialMigration,
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
    symlinkSync(
      path.join(repo, "packages/db/node_modules"),
      path.join(root, "packages/db/node_modules"),
    );
    for (const dir of [
      "packages/db/src/schema",
      "packages/db/migrations",
      "packages/db/initial-sql",
      "ops/postgres",
    ])
      cpSync(path.join(repo, dir), path.join(root, dir), { recursive: true });
    const index = path.join(root, "packages/db/src/schema/index.ts");
    writeFileSync(index, `${readFileSync(index, "utf8")}\n${schema}`);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts the regenerated initial migration before commit", () => {
  schemaFixture("", (root) => assert.doesNotThrow(() => checkMigrations(root)));
});
test("fails when the initial migration misses a schema change", () => {
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

test("refuses a migration that Postgres cannot apply", () => {
  schemaFixture("", (root) => {
    const file = path.join(root, "packages/db/migrations/0000_initial.sql");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("E'\\x3B', '|')", "'),"),
    );
    assert.throws(
      () => applyInitialMigration(root),
      /Migration does not apply/,
    );
  });
});

test("refuses a second migration before deployment", () => {
  schemaFixture("", (root) => {
    writeFileSync(
      path.join(root, "packages/db/migrations/0001_extra.sql"),
      "select 1;",
    );
    assert.throws(() => checkMigrations(root), /only 0000_initial/);
  });
});
test("refuses a missing initial migration", () => {
  schemaFixture("", (root) => {
    rmSync(path.join(root, "packages/db/migrations/0000_initial.sql"));
    assert.throws(() => checkMigrations(root), /only 0000_initial/);
  });
});
test("refuses a missing owner index even when the snapshot is unchanged", () => {
  schemaFixture("", (root) => {
    const file = path.join(root, "packages/db/migrations/0000_initial.sql");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        /CREATE UNIQUE INDEX "users_single_owner_idx"[^;]+;/,
        "",
      ),
    );
    assert.throws(() => checkMigrations(root), /Migration drift: initial SQL/);
  });
});
test("refuses changed audit grants", () => {
  schemaFixture("", (root) => {
    const file = path.join(root, "packages/db/migrations/0000_initial.sql");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        "GRANT SELECT, INSERT ON TABLE public.audit_log",
        "GRANT SELECT, INSERT, UPDATE ON TABLE public.audit_log",
      ),
    );
    assert.throws(() => checkMigrations(root), /Migration drift: initial SQL/);
  });
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
