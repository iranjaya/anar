import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { migrationCoverageSql } from "./migration-coverage.ts";

type Journal = {
  version: string;
  dialect: string;
  entries: {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }[];
};

function journal(files: Map<string, string>): Journal {
  return JSON.parse(files.get("meta/_journal.json") ?? "null");
}

export function assertAppendOnly(
  frozen: Map<string, string>,
  actual: Map<string, string>,
): void {
  for (const name of migrationDrift(frozen, actual)) {
    if (frozen.has(name) && name !== "meta/_journal.json")
      throw new Error(`Frozen migration changed or removed: ${name}`);
  }
  const before = journal(frozen);
  const after = journal(actual);
  if (
    !after ||
    before.version !== after.version ||
    before.dialect !== after.dialect ||
    !isDeepStrictEqual(
      before.entries,
      after.entries?.slice(0, before.entries.length),
    )
  )
    throw new Error("Frozen journal entries changed, removed or reordered");
}

export function checkHistory(
  root: string,
  actual: Map<string, string>,
  readGit?: (args: string[]) => string,
): Journal {
  const frozen = JSON.parse(
    readFileSync(path.join(root, "docs/migrations/frozen.json"), "utf8"),
  );
  for (const [name, hash] of Object.entries(frozen.files)) {
    if (
      createHash("sha256")
        .update(actual.get(name) ?? "")
        .digest("hex") !== hash
    )
      throw new Error(`Frozen migration changed or removed: ${name}`);
  }
  assertAppendOnly(
    new Map([["meta/_journal.json", JSON.stringify(frozen.journal)]]),
    actual,
  );
  if (readGit || existsSync(path.join(root, ".git"))) {
    const git =
      readGit ??
      ((args: string[]) =>
        execFileSync("git", args, {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }));
    const changed = git([
      "log",
      "--format=",
      "--name-only",
      "--diff-filter=DMRT",
      "--full-history",
      "--diff-merges=separate",
      `${frozen.revision}..HEAD`,
      "--",
      "packages/db/migrations",
      ":(exclude)packages/db/migrations/meta/_journal.json",
    ]).trim();
    if (changed)
      throw new Error(`Committed migrations changed or removed: ${changed}`);
    const revisions = git([
      "log",
      "--reverse",
      "--topo-order",
      "--full-history",
      "--diff-merges=separate",
      "--format=%H",
      `${frozen.revision}..HEAD`,
      "--",
      "packages/db/migrations/meta/_journal.json",
    ])
      .trim()
      .split("\n")
      .filter(Boolean);
    let prior = new Map([
      ["meta/_journal.json", JSON.stringify(frozen.journal)],
    ]);
    for (const revision of revisions) {
      const next = new Map([
        [
          "meta/_journal.json",
          git([
            "show",
            `${revision}:packages/db/migrations/meta/_journal.json`,
          ]),
        ],
      ]);
      assertAppendOnly(prior, next);
      prior = next;
    }
    assertAppendOnly(prior, actual);
    const read = (name: string) =>
      git(["show", `HEAD:packages/db/migrations/${name}`]);
    const committed = new Map([
      ["meta/_journal.json", read("meta/_journal.json")],
    ]);
    for (const entry of journal(committed).entries) {
      for (const name of [
        `${entry.tag}.sql`,
        `meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`,
      ])
        committed.set(name, read(name));
    }
    assertAppendOnly(committed, actual);
  }
  const current = journal(actual);
  const required = new Set(["meta/_journal.json"]);
  let previousId = "00000000-0000-0000-0000-000000000000";
  for (const [idx, entry] of current.entries.entries()) {
    const prefix = String(idx).padStart(4, "0");
    if (
      entry.idx !== idx ||
      !new RegExp(`^${prefix}_[a-zA-Z0-9_-]+$`).test(entry.tag) ||
      entry.version !== current.version ||
      entry.breakpoints !== true ||
      !Number.isSafeInteger(entry.when) ||
      entry.when <= (current.entries[idx - 1]?.when ?? 0)
    )
      throw new Error(
        "Migrations must append numbered journal entries in timestamp order",
      );
    required.add(`${entry.tag}.sql`);
    const name = `meta/${prefix}_snapshot.json`;
    required.add(name);
    const snapshot = JSON.parse(actual.get(name) ?? "null");
    if (!snapshot?.id || snapshot.prevId !== previousId)
      throw new Error(`Migration snapshot chain is broken: ${name}`);
    previousId = snapshot.id;
  }
  if (!isDeepStrictEqual([...required].sort(), [...actual.keys()].sort()))
    throw new Error(
      "Migration files must match their journal entries and snapshots",
    );
  return current;
}

export function migrationFiles(dir: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!existsSync(dir)) return result;
  function visit(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else result.set(path.relative(dir, file), readFileSync(file, "utf8"));
    }
  }
  visit(dir);
  return result;
}

export function migrationDrift(
  expected: Map<string, string>,
  actual: Map<string, string>,
): string[] {
  return [...new Set([...expected.keys(), ...actual.keys()])]
    .sort()
    .filter((name) => expected.get(name) !== actual.get(name));
}

// Drizzle can write SQL that its own snapshot compare accepts but Postgres rejects,
// so the committed migration is also applied to a throwaway database.
export function applyMigrationHistory(root: string, expectedSql: string): void {
  const name = `anar-migration-check-${randomUUID()}`;
  const docker = (args: string[], input?: string) =>
    execFileSync("docker", args, {
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000,
    });
  const secret = () => randomBytes(18).toString("hex");
  try {
    docker([
      "run",
      "--detach",
      "--name",
      name,
      "--mount",
      `type=bind,source=${path.join(root, "ops/postgres")},target=/opt/anar-postgres,readonly`,
      "--env",
      "POSTGRES_DB=anar",
      "--env",
      `POSTGRES_PASSWORD=${secret()}`,
      "--env",
      `APP_DATABASE_PASSWORD=${secret()}`,
      "--env",
      `MIGRATION_DATABASE_PASSWORD=${secret()}`,
      "postgres:17",
    ]);
    const deadline = Date.now() + 30000;
    while (true) {
      try {
        docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-d", "anar"]);
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      }
    }
    docker(["exec", name, "/opt/anar-postgres/bootstrap.sh"]);
    const sql = (database: string, source: string) =>
      docker(
        [
          "exec",
          "--interactive",
          name,
          "psql",
          "-X",
          "--set=ON_ERROR_STOP=1",
          "--single-transaction",
          "--username=anar_migrate",
          `--dbname=${database}`,
          "--file=-",
        ],
        source,
      );
    try {
      const history = migrationFiles(path.join(root, "packages/db/migrations"));
      for (const entry of journal(history).entries)
        sql("anar", history.get(`${entry.tag}.sql`) ?? "");
      const checkCoverage = () => {
        const failures = docker([
          "exec",
          name,
          "psql",
          "-XAt",
          "--set=ON_ERROR_STOP=1",
          "--username=anar_migrate",
          "--dbname=anar",
          "--command",
          migrationCoverageSql,
        ]).trim();
        if (failures)
          throw new Error(
            `Migration RLS or grant coverage failed: ${failures}`,
          );
      };
      checkCoverage();
      docker(["exec", name, "/opt/anar-postgres/bootstrap.sh"]);
      checkCoverage();
      docker([
        "exec",
        name,
        "createdb",
        "--username=postgres",
        "--owner=anar_migrate",
        "expected",
      ]);
      sql("expected", expectedSql);
      const dump = (database: string) =>
        docker([
          "exec",
          name,
          "pg_dump",
          "--username=anar_migrate",
          "--dbname",
          database,
          "--schema-only",
          "--schema=public",
          "--no-owner",
          "--no-privileges",
        ])
          .split("\n")
          .filter(
            (line) =>
              !line.startsWith("--") &&
              !line.startsWith("\\") &&
              !/^ALTER TABLE .+ FORCE ROW LEVEL SECURITY;$/.test(line) &&
              line.trim(),
          )
          .join("\n");
      if (dump("anar") !== dump("expected"))
        throw new Error("Migration drift: applied DDL differs from schema");
    } catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? "");
      if (!stderr) throw error;
      throw new Error(
        `Migration does not apply: ${stderr.trim().split("\n")[0]}`,
      );
    }
  } finally {
    try {
      docker(["rm", "--force", "--volumes", name]);
    } catch {}
  }
}

export function checkMigrations(root: string): void {
  const cache = path.join(root, ".cache");
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(path.join(cache, "migrations-"));
  const history = path.join(root, "packages/db/migrations");
  const generated = path.join(scratch, "generated");
  const packageDir = path.join(root, "packages/db");
  try {
    const entries = checkHistory(root, migrationFiles(history)).entries;
    const config = path.join(scratch, "drizzle.config.ts");
    writeFileSync(
      config,
      `import config from ${JSON.stringify(path.join(packageDir, "drizzle.config.ts"))};\nexport default { ...config, out: ${JSON.stringify(path.relative(packageDir, generated))} };\n`,
    );
    const output = execFileSync(
      process.execPath,
      [
        path.join(packageDir, "node_modules/drizzle-kit/bin.cjs"),
        "generate",
        "--config",
        config,
        "--name",
        "initial",
      ],
      {
        cwd: packageDir,
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL:
            "postgresql://unused:unused@127.0.0.1:1/unused",
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    process.stdout.write(output);
    if (!/^\d+ tables\s*$/m.test(output))
      throw new Error("Drizzle did not report a generated schema");
    const read = (dir: string, name: string) =>
      readFileSync(path.join(dir, name), "utf8");
    const expectedSql = [
      read(packageDir, "initial-sql/before.sql"),
      read(generated, "0000_initial.sql"),
      read(packageDir, "initial-sql/after.sql"),
    ].join("\n--> statement-breakpoint\n");
    const snapshot = (dir: string, name: string) => {
      const {
        id: _id,
        prevId: _prevId,
        ...schema
      } = JSON.parse(read(dir, name));
      return schema;
    };
    if (
      !isDeepStrictEqual(
        snapshot(
          history,
          `meta/${String(entries.length - 1).padStart(4, "0")}_snapshot.json`,
        ),
        snapshot(generated, "meta/0000_snapshot.json"),
      )
    )
      throw new Error("Migration drift: latest snapshot differs from schema");
    applyMigrationHistory(root, expectedSql);
    console.log(
      "Migrations passed: append-only history, no SQL or schema drift, RLS and grants covered on Postgres 17.",
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main)
  checkMigrations(fileURLToPath(new URL("../", import.meta.url)));
