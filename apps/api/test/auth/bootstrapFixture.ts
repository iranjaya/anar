import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPlatformDb } from "@anar/db/platform";
import type { SQL } from "drizzle-orm";
import { expect } from "vitest";
import { startPostgres } from "../../../../test/support/postgres.js";

const run = promisify(execFile);
const dbDirectory = fileURLToPath(
  new URL("../../../../packages/db/", import.meta.url),
);

export async function startBootstrapFixture(beforeOwner = false) {
  const postgres = await startPostgres();
  let db: Awaited<ReturnType<typeof createPlatformDb>> | undefined;
  let scratch: string | undefined;
  const close = async () => {
    try {
      await db?.close();
    } finally {
      try {
        await postgres.stop();
      } finally {
        if (scratch) await rm(scratch, { recursive: true, force: true });
      }
      expect(
        (
          await run("docker", [
            "ps",
            "-aq",
            "--filter",
            `name=^/${postgres.name}$`,
          ])
        ).stdout.trim(),
      ).toBe("");
    }
  };
  try {
    await postgres.bootstrap();
    if (beforeOwner) {
      const journal = JSON.parse(
        await readFile(
          path.join(dbDirectory, "migrations/meta/_journal.json"),
          "utf8",
        ),
      ) as {
        entries: { tag: string; idx: number; when: number }[];
      };
      const ownerIndex = journal.entries.findIndex(
        (entry) => entry.tag === "0004_single-owner",
      );
      expect(ownerIndex).toBeGreaterThan(0);
      journal.entries = journal.entries.slice(0, ownerIndex);
      scratch = await mkdtemp(path.join(tmpdir(), "anar-owner-upgrade-"));
      await cp(path.join(dbDirectory, "dist"), path.join(scratch, "dist"), {
        recursive: true,
      });
      await symlink(
        path.join(dbDirectory, "node_modules"),
        path.join(scratch, "node_modules"),
        "dir",
      );
      await mkdir(path.join(scratch, "migrations/meta"), { recursive: true });
      await writeFile(
        path.join(scratch, "migrations/meta/_journal.json"),
        JSON.stringify(journal),
      );
      for (const entry of journal.entries)
        await cp(
          path.join(dbDirectory, `migrations/${entry.tag}.sql`),
          path.join(scratch, `migrations/${entry.tag}.sql`),
        );
      await run(process.execPath, [path.join(scratch, "dist/migrate.js")], {
        env: { ...process.env, MIGRATION_DATABASE_URL: postgres.migrationUrl },
        timeout: 20000,
      });
    } else {
      await postgres.migrate();
      await postgres.bootstrap();
      await postgres.migrate();
    }
    db = await createPlatformDb(postgres.appUrl);
    const runtime = db;
    return {
      postgres,
      db: runtime,
      close,
      rows: <T extends Record<string, unknown>>(query: SQL) =>
        runtime.transaction(async (tx) => (await tx.execute<T>(query)).rows),
      owner(query: string) {
        return run("docker", [
          "exec",
          postgres.name,
          "psql",
          "-X",
          "-q",
          "-U",
          "anar_migrate",
          "-d",
          "anar_s04",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          query,
        ]);
      },
      cli(args: string[], env: NodeJS.ProcessEnv = {}) {
        return run(
          process.execPath,
          [
            fileURLToPath(
              new URL("../../dist/modules/auth/bootstrap.js", import.meta.url),
            ),
            ...args,
          ],
          {
            env: {
              ...process.env,
              NODE_OPTIONS: "",
              ANAR_ENV: "proof",
              DATABASE_URL: postgres.appUrl,
              ...env,
            },
            timeout: 8000,
          },
        );
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export type BootstrapFixture = Awaited<
  ReturnType<typeof startBootstrapFixture>
>;
