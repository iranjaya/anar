import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function startPostgres() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a free loopback port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  const name = `anar-s04-${randomUUID()}`;
  const passwords = {
    admin: randomBytes(18).toString("hex"),
    migration: randomBytes(18).toString("hex"),
    app: randomBytes(18).toString("hex"),
  };
  const url = (role: string, password: string) =>
    `postgresql://${role}:${password}@127.0.0.1:${port}/anar_s04`;
  const stop = () =>
    run("docker", ["rm", "--force", "--volumes", name], { timeout: 15000 });

  try {
    await run(
      "docker",
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        name,
        "--publish",
        `127.0.0.1:${port}:5432`,
        "--mount",
        `type=bind,source=${fileURLToPath(new URL("../../../ops/postgres", import.meta.url))},target=/opt/anar-postgres,readonly`,
        "--env",
        "POSTGRES_DB=anar_s04",
        "--env",
        `POSTGRES_PASSWORD=${passwords.admin}`,
        "--env",
        `APP_DATABASE_PASSWORD=${passwords.app}`,
        "--env",
        `MIGRATION_DATABASE_PASSWORD=${passwords.migration}`,
        "postgres:17",
      ],
      { timeout: 15000 },
    );
    const deadline = Date.now() + 30000;
    while (true) {
      try {
        await run("docker", [
          "exec",
          name,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "postgres",
          "-d",
          "anar_s04",
        ]);
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await setTimeout(200);
      }
    }
    return {
      name,
      port,
      adminUrl: url("postgres", passwords.admin),
      migrationUrl: url("anar_migrate", passwords.migration),
      appUrl: url("anar_app", passwords.app),
      bootstrap: () =>
        run("docker", ["exec", name, "/opt/anar-postgres/bootstrap.sh"]),
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

export type Postgres = Awaited<ReturnType<typeof startPostgres>>;
