import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
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
  assertAppendOnly,
  checkHistory,
  checkMigrations,
  migrationDrift,
  migrationFiles,
} from "./check-migrations.ts";
import { migrationCoverageSql } from "./migration-coverage.ts";

const repo = fileURLToPath(new URL("../", import.meta.url));
const history = "packages/db/migrations";
const sampleSql = `${history}/0001_sample.sql`;
const sampleSchema = `
import { pgTable } from "drizzle-orm/pg-core";
import { companyColumns, companyPolicies } from "./companyRows.js";
export const sample = pgTable("deployment_fixture", companyColumns(),
  (table) => companyPolicies("deployment_fixture", table.companyId)).enableRLS();
`;

async function schemaFixture(
  schema: string,
  run: (root: string) => void | Promise<void>,
) {
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
      history,
      "packages/db/initial-sql",
      "ops/postgres",
      "docs/migrations",
    ])
      cpSync(path.join(repo, dir), path.join(root, dir), { recursive: true });
    const index = path.join(root, "packages/db/src/schema/index.ts");
    writeFileSync(index, `${readFileSync(index, "utf8")}\n${schema}`);
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function change(root: string, file: string, edit: (text: string) => string) {
  const target = path.join(root, file);
  writeFileSync(target, edit(readFileSync(target, "utf8")));
}

function appendSample(root: string, schema = sampleSchema) {
  change(root, "packages/db/src/schema/index.ts", (text) => text + schema);
  execFileSync(
    process.execPath,
    ["node_modules/drizzle-kit/bin.cjs", "generate", "--name", "sample"],
    {
      cwd: path.join(root, "packages/db"),
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  change(
    root,
    sampleSql,
    (text) => `${text}
--> statement-breakpoint
ALTER TABLE public.deployment_fixture FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.deployment_fixture FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.deployment_fixture TO anar_app;
`,
  );
  change(root, "ops/postgres/roles.sql", (text) =>
    text.replace(
      "'company_job_periods')",
      "'company_job_periods', 'deployment_fixture')",
    ),
  );
}

test("accepts the frozen initial migration", () =>
  schemaFixture("", (root) =>
    assert.doesNotThrow(() => checkMigrations(root)),
  ));

test("refuses edits and removal of frozen SQL and snapshots", async (t) => {
  for (const file of ["0000_initial.sql", "meta/0000_snapshot.json"]) {
    for (const remove of [false, true]) {
      await t.test(`${remove ? "removed" : "changed"} ${file}`, () =>
        schemaFixture("", (root) => {
          const target = path.join(root, history, file);
          if (remove) rmSync(target);
          else writeFileSync(target, `${readFileSync(target, "utf8")}\n`);
          assert.throws(
            () => checkMigrations(root),
            /Frozen migration changed or removed/,
          );
        }),
      );
    }
  }
});

test("refuses changes to every frozen journal field", async (t) => {
  for (const field of ["idx", "version", "when", "tag", "breakpoints"]) {
    await t.test(field, () =>
      schemaFixture("", (root) => {
        change(root, `${history}/meta/_journal.json`, (text) => {
          const journal = JSON.parse(text);
          journal.entries[0][field] = null;
          return JSON.stringify(journal);
        });
        assert.throws(() => checkMigrations(root), /Frozen journal entries/);
      }),
    );
  }
  for (const replacement of [
    "null",
    '{"version":"7","dialect":"postgresql","entries":[]}',
  ]) {
    await t.test(replacement, () =>
      schemaFixture("", (root) => {
        writeFileSync(
          path.join(root, history, "meta/_journal.json"),
          replacement,
        );
        assert.throws(() => checkMigrations(root), /Frozen journal entries/);
      }),
    );
  }
});

test("refuses a changed owner index or audit grants", async (t) => {
  for (const edit of [
    (text: string) =>
      text.replace(/CREATE UNIQUE INDEX "users_single_owner_idx"[^;]+;/, ""),
    (text: string) =>
      text.replace(
        "GRANT SELECT, INSERT ON TABLE public.audit_log",
        "GRANT SELECT, INSERT, UPDATE ON TABLE public.audit_log",
      ),
  ]) {
    await t.test(edit.name || "changed SQL", () =>
      schemaFixture("", (root) => {
        change(root, `${history}/0000_initial.sql`, edit);
        assert.throws(() => checkMigrations(root), /Frozen migration changed/);
      }),
    );
  }
});

test("fails when migrations miss a schema change", () =>
  schemaFixture(sampleSchema, (root) =>
    assert.throws(() => checkMigrations(root), /Migration drift/),
  ));
test("fails on a broken schema even when Drizzle exits zero", () =>
  schemaFixture('throw new Error("broken schema");', (root) =>
    assert.throws(() => checkMigrations(root)),
  ));
test("refuses files without a journal entry", () =>
  schemaFixture("", (root) => {
    writeFileSync(path.join(root, history, "0001_extra.sql"), "select 1;");
    assert.throws(() => checkMigrations(root), /files must match/);
  }));

test("checks appended migrations against the schema and permissions", () =>
  schemaFixture("", async (root) => {
    appendSample(root);
    const frozen = migrationFiles(path.join(root, history));
    assert.doesNotThrow(() => checkMigrations(root));
    for (const [name, contents] of frozen) {
      const changed = new Map(frozen);
      if (name === "meta/_journal.json") {
        const journal = JSON.parse(contents);
        journal.entries[1].when += 1;
        changed.set(name, JSON.stringify(journal));
      } else changed.set(name, `${contents}\n`);
      assert.throws(() => assertAppendOnly(frozen, changed), /Frozen/);
      changed.delete(name);
      assert.throws(() => assertAppendOnly(frozen, changed), /Frozen/);
    }
    const reordered = new Map(frozen);
    const journal = JSON.parse(frozen.get("meta/_journal.json") ?? "");
    journal.entries.reverse();
    reordered.set("meta/_journal.json", JSON.stringify(journal));
    assert.throws(() => assertAppendOnly(frozen, reordered), /reordered/);

    const cases: [string, string, (text: string) => string, RegExp][] = [
      [
        "bad SQL",
        sampleSql,
        (text) => `${text}\ninvalid syntax;`,
        /Migration does not apply/,
      ],
      ["missing DDL", sampleSql, () => "SELECT 1;", /applied DDL differs/],
      [
        "changed DDL",
        sampleSql,
        (text) => text.replace('"created_at"', '"wrong_column"'),
        /applied DDL differs/,
      ],
      [
        "missing FORCE RLS",
        sampleSql,
        (text) =>
          text.replace(
            "ALTER TABLE public.deployment_fixture FORCE ROW LEVEL SECURITY;",
            "",
          ),
        /coverage failed: deployment_fixture/,
      ],
      [
        "missing RLS",
        sampleSql,
        (text) =>
          text.replace(
            'ALTER TABLE "deployment_fixture" ENABLE ROW LEVEL SECURITY;',
            "",
          ),
        /coverage failed: deployment_fixture/,
      ],
      [
        "wide grants",
        sampleSql,
        (text) =>
          text.replace(
            "GRANT SELECT, INSERT, UPDATE",
            "GRANT SELECT, INSERT, UPDATE, DELETE",
          ),
        /coverage failed: deployment_fixture/,
      ],
      [
        "PUBLIC grant",
        sampleSql,
        (text) =>
          `${text}\nGRANT SELECT ON public.deployment_fixture TO PUBLIC;`,
        /coverage failed: deployment_fixture/,
      ],
      [
        "missing grants",
        sampleSql,
        (text) =>
          text.replace(
            "GRANT SELECT, INSERT, UPDATE ON public.deployment_fixture TO anar_app;",
            "",
          ),
        /coverage failed: deployment_fixture/,
      ],
      [
        "bootstrap widens grants",
        "ops/postgres/roles.sql",
        (text) => text.replace(", 'deployment_fixture')", ")"),
        /coverage failed: deployment_fixture/,
      ],
      [
        "audit UPDATE",
        sampleSql,
        (text) => `${text}\nGRANT UPDATE ON public.audit_log TO anar_app;`,
        /coverage failed: audit_log/,
      ],
      [
        "broken snapshot link",
        `${history}/meta/0001_snapshot.json`,
        (text) => JSON.stringify({ ...JSON.parse(text), prevId: randomUUID() }),
        /snapshot chain is broken/,
      ],
      [
        "old timestamp",
        `${history}/meta/_journal.json`,
        (text) => {
          const journal = JSON.parse(text);
          journal.entries[1].when = journal.entries[0].when;
          return JSON.stringify(journal);
        },
        /timestamp order/,
      ],
      [
        "wrong number",
        `${history}/meta/_journal.json`,
        (text) => {
          const journal = JSON.parse(text);
          journal.entries[1].idx = 2;
          return JSON.stringify(journal);
        },
        /numbered journal/,
      ],
    ];
    for (const [name, file, edit, error] of cases) {
      const target = path.join(root, file);
      const original = readFileSync(target, "utf8");
      try {
        change(root, file, edit);
        assert.throws(() => checkMigrations(root), error, name);
      } finally {
        writeFileSync(target, original);
      }
    }
  }));

test("rejects agency-only policies on an appended company table", () =>
  schemaFixture("", (root) => {
    appendSample(
      root,
      `
      import { sql } from "drizzle-orm";
      import { pgTable, pgPolicy } from "drizzle-orm/pg-core";
      import { companyColumns } from "./companyRows.js";
      const weak = sql\`company_id = NULLIF(current_setting('app.agency_id', true), '')::uuid\`;
      export const sample = pgTable("deployment_fixture", companyColumns(), () => [
        pgPolicy("fixture_select", { for: "select", to: "anar_app", using: weak }),
        pgPolicy("fixture_insert", { for: "insert", to: "anar_app", withCheck: weak }),
        pgPolicy("fixture_update", { for: "update", to: "anar_app", using: weak, withCheck: weak }),
      ]).enableRLS();
    `,
    );
    assert.throws(
      () => checkMigrations(root),
      /coverage failed: deployment_fixture/,
    );
  }));

test("protects committed migrations and journal entries after later commits", () =>
  schemaFixture("", (root) => {
    appendSample(root);
    const committed = migrationFiles(path.join(root, history));
    const readGit = (args: string[]) => {
      if (args[0] === "log")
        return args.includes("--name-only") ? "" : "appended\n";
      const file = args[1]?.split(":packages/db/migrations/")[1] ?? "";
      return committed.get(file) ?? "";
    };
    assert.doesNotThrow(() => checkHistory(root, committed, readGit));
    for (const file of ["0001_sample.sql", "meta/0001_snapshot.json"]) {
      const edited = new Map(committed);
      edited.set(file, `${committed.get(file)}\n`);
      assert.throws(
        () =>
          checkHistory(root, edited, (args) =>
            args.includes("--name-only")
              ? `${history}/${file}\n`
              : readGit(args),
          ),
        /Committed migrations changed or removed/,
      );
    }
    const edited = new Map(committed);
    const journal = JSON.parse(committed.get("meta/_journal.json") ?? "");
    journal.entries[1].when += 1;
    edited.set("meta/_journal.json", JSON.stringify(journal));
    assert.throws(
      () =>
        checkHistory(root, edited, (args) => {
          if (args[0] === "log")
            return args.includes("--name-only") ? "" : "appended\nedited\n";
          if (args[1]?.startsWith("edited:")) return JSON.stringify(journal);
          return readGit(args);
        }),
      /Frozen journal entries/,
    );
    for (const file of ["0001_sample.sql", "meta/0001_snapshot.json"]) {
      const edited = new Map(committed);
      edited.set(file, `${committed.get(file)}\n`);
      assert.throws(
        () => checkHistory(root, edited, readGit),
        /Frozen migration changed/,
      );
    }
  }));

test("migrates fresh, repeats without changes, then upgrades with an appended migration", () =>
  schemaFixture("", (root) => {
    const project = `anar-migration-proof-${randomUUID()}`;
    const password = randomBytes(18).toString("hex");
    const composeFile = path.join(root, "proof-compose.json");
    writeFileSync(
      composeFile,
      JSON.stringify({
        services: {
          db: {
            image: "postgres:17",
            environment: {
              POSTGRES_DB: "anar",
              POSTGRES_PASSWORD: password,
              APP_DATABASE_PASSWORD: password,
              MIGRATION_DATABASE_PASSWORD: password,
            },
            ports: ["127.0.0.1::5432"],
            tmpfs: ["/var/lib/postgresql/data"],
            volumes: [
              `${path.join(root, "ops/postgres")}:/opt/anar-postgres:ro`,
            ],
            healthcheck: {
              test: [
                "CMD",
                "pg_isready",
                "-h",
                "127.0.0.1",
                "-U",
                "postgres",
                "-d",
                "anar",
              ],
              interval: "1s",
              timeout: "2s",
              retries: 30,
            },
          },
        },
      }),
    );
    const compose = (args: string[]) =>
      execFileSync(
        "docker",
        [
          "compose",
          "--project-name",
          project,
          "--env-file",
          "/dev/null",
          "--file",
          composeFile,
          ...args,
        ],
        {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 60000,
        },
      );
    const query = (sql: string, database = "anar") =>
      compose([
        "exec",
        "-T",
        "db",
        "psql",
        "-XAt",
        "--set=ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        database,
        "-c",
        sql,
      ]).trim();
    const bootstrap = (database = "anar") =>
      compose([
        "exec",
        "-T",
        "--env",
        `POSTGRES_DB=${database}`,
        "db",
        "/opt/anar-postgres/bootstrap.sh",
      ]);
    try {
      compose(["up", "--detach", "--wait"]);
      const port = Number(
        compose(["port", "db", "5432"]).trim().split(":").at(-1),
      );
      assert.ok(Number.isInteger(port) && port > 0);
      assert.ok(![3000, 3001, 3100, 8080].includes(port));
      const migrate = (database = "anar") =>
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            `
      import { createRequire } from 'node:module';
      const require = createRequire(${JSON.stringify(path.join(root, "packages/db/package.json"))});
      const { Pool } = require('pg');
      const { drizzle } = require('drizzle-orm/node-postgres');
      const { migrate } = require('drizzle-orm/node-postgres/migrator');
      const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
      try { await migrate(drizzle(pool), { migrationsFolder: ${JSON.stringify(path.join(root, history))} }); }
      finally { await pool.end(); }
    `,
          ],
          {
            env: {
              ...process.env,
              MIGRATION_DATABASE_URL: `postgresql://anar_migrate:${password}@127.0.0.1:${port}/${database}`,
            },
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 20000,
          },
        );
      const ledger = (database = "anar") =>
        query(
          "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id",
          database,
        );
      bootstrap();
      migrate();
      const initialLedger = ledger();
      query(
        "INSERT INTO public.worker_heartbeats (worker_id, started_at, last_seen_at) VALUES ('synthetic-migration-proof', now(), now())",
      );
      migrate();
      assert.equal(ledger(), initialLedger);
      bootstrap();
      bootstrap();
      assert.equal(query(migrationCoverageSql), "");
      appendSample(root);
      checkMigrations(root);
      migrate();
      const upgradedLedger = ledger();
      assert.equal(upgradedLedger.split("\n").length, 2);
      assert.ok(upgradedLedger.startsWith(initialLedger));
      assert.equal(
        query(
          "SELECT count(*) FROM public.worker_heartbeats WHERE worker_id = 'synthetic-migration-proof'",
        ),
        "1",
      );
      assert.equal(
        query("SELECT to_regclass('public.deployment_fixture')"),
        "deployment_fixture",
      );
      migrate();
      assert.equal(ledger(), upgradedLedger);
      bootstrap();
      bootstrap();
      assert.equal(query(migrationCoverageSql), "");
      query("CREATE DATABASE appended_fresh OWNER anar_migrate");
      bootstrap("appended_fresh");
      migrate("appended_fresh");
      assert.equal(ledger("appended_fresh"), upgradedLedger);
      assert.equal(query(migrationCoverageSql, "appended_fresh"), "");
      console.log(
        `${project}: fresh migrate, repeat no-op, repeated bootstrap, appended upgrade and fresh chain passed; port ${port}.`,
      );
    } finally {
      compose(["down", "--timeout", "5"]);
    }
  }));

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
