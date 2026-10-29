import { execFileSync } from "node:child_process";
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

export function checkMigrations(root: string): void {
  const cache = path.join(root, ".cache");
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(path.join(cache, "migrations-"));
  const history = path.join(root, "packages/db/migrations");
  const generated = path.join(scratch, "generated");
  const packageDir = path.join(root, "packages/db");
  try {
    const baseline = migrationFiles(history);
    const required = [
      "0000_initial.sql",
      "meta/0000_snapshot.json",
      "meta/_journal.json",
    ];
    if (
      JSON.stringify([...baseline.keys()].sort()) !== JSON.stringify(required)
    )
      throw new Error(
        "Pre-deploy migrations must contain only 0000_initial.sql and its metadata",
      );
    const journal = JSON.parse(
      readFileSync(path.join(history, "meta/_journal.json"), "utf8"),
    );
    if (
      journal.entries?.length !== 1 ||
      journal.entries[0].idx !== 0 ||
      journal.entries[0].tag !== "0000_initial"
    )
      throw new Error(
        "Pre-deploy migrations require one initial journal entry",
      );
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
    const statements = (sql: string) =>
      sql
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);
    const expectedSql = [
      read(packageDir, "initial-sql/before.sql"),
      read(generated, "0000_initial.sql"),
      read(packageDir, "initial-sql/after.sql"),
    ].flatMap(statements);
    if (
      JSON.stringify(statements(read(history, "0000_initial.sql"))) !==
      JSON.stringify(expectedSql)
    )
      throw new Error(
        "Migration drift: initial SQL differs from schema and reviewed custom SQL",
      );
    const snapshot = (dir: string) => {
      const { id: _id, ...schema } = JSON.parse(
        read(dir, "meta/0000_snapshot.json"),
      );
      return schema;
    };
    if (
      JSON.stringify(snapshot(history)) !== JSON.stringify(snapshot(generated))
    )
      throw new Error("Migration drift: initial snapshot differs from schema");
    console.log(
      "Migrations passed: one initial migration, no SQL or schema drift.",
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main)
  checkMigrations(fileURLToPath(new URL("../", import.meta.url)));
