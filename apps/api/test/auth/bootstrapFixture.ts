import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPlatformDb } from "@anar/db/platform";
import type { SQL } from "drizzle-orm";
import { expect } from "vitest";
import { startPostgres } from "../../../../test/support/postgres.js";

const run = promisify(execFile);
export async function startBootstrapFixture() {
  const postgres = await startPostgres();
  let db: Awaited<ReturnType<typeof createPlatformDb>> | undefined;
  const close = async () => {
    try {
      await db?.close();
    } finally {
      await postgres.stop();
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
    await postgres.migrate();
    await postgres.bootstrap();
    await postgres.migrate();
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
