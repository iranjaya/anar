import { execFileSync } from "node:child_process";
import {
  cpSync,
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
  const history = path.join(scratch, "history");
  const generated = path.join(scratch, "generated");
  const packageDir = path.join(root, "packages/db");
  try {
    mkdirSync(history);
    const tracked = execFileSync(
      "git",
      ["ls-tree", "-r", "--name-only", "HEAD", "--", "packages/db/migrations"],
      { cwd: root, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const file of tracked) {
      const destination = path.join(
        history,
        path.relative("packages/db/migrations", file),
      );
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(
        destination,
        execFileSync("git", ["show", `HEAD:${file}`], { cwd: root }),
      );
    }
    cpSync(history, generated, { recursive: true });
    const config = path.join(scratch, "drizzle.config.ts");
    writeFileSync(
      config,
      `import config from ${JSON.stringify(path.join(packageDir, "drizzle.config.ts"))};\nexport default { ...config, out: ${JSON.stringify(generated)} };\n`,
    );
    const output = execFileSync(
      process.execPath,
      [
        path.join(packageDir, "node_modules/drizzle-kit/bin.cjs"),
        "generate",
        "--config",
        config,
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
    const baseline = migrationFiles(history);
    const expected = migrationFiles(generated);
    if (!baseline.size && expected.size === 1) {
      const journal = expected.get("meta/_journal.json");
      if (
        journal &&
        JSON.stringify(JSON.parse(journal)) ===
          JSON.stringify({ version: "7", dialect: "postgresql", entries: [] })
      )
        expected.clear();
    }
    const schemaDrift = migrationDrift(baseline, expected);
    const workingDrift = migrationDrift(
      baseline,
      migrationFiles(path.join(packageDir, "migrations")),
    );
    if (schemaDrift.length || workingDrift.length)
      throw new Error(
        `Migration drift: ${[...new Set([...schemaDrift, ...workingDrift])].join(", ")}`,
      );
    console.log(
      `Migrations passed: ${baseline.size} committed SQL/metadata files, no schema or working-tree drift.`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main)
  checkMigrations(fileURLToPath(new URL("../", import.meta.url)));
