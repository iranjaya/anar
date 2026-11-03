import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { listTar } from "./backup/tar.ts";
import type { BackupRunner } from "./local-backup.ts";

const exec = promisify(execFile);
async function processStart(pid: number): Promise<string> {
  try {
    return (
      await exec("ps", ["-o", "lstart=", "-p", String(pid)])
    ).stdout.trim();
  } catch (error) {
    if ((error as { code?: number }).code === 1) return "";
    throw error;
  }
}
export const snapshotTables = [
  "agencies",
  "companies",
  "users",
  "sessions",
  "company_members",
  "leads",
  "lead_events",
  "follow_ups",
  "import_batches",
  "import_runs",
  "import_rows",
  "notifications",
  "notification_deliveries",
  "scoring_configs",
] as const;

export type BackupIO = {
  docker(args: string[], signal?: AbortSignal): Promise<string>;
  dockerToFile(
    args: string[],
    output: string,
    signal: AbortSignal,
  ): Promise<void>;
  revision(): Promise<string>;
};

function runtimeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "HOME",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "TMPDIR",
  ])
    if (process.env[name]) env[name] = process.env[name];
  return env;
}

export function commandBackupIO(repository: string): BackupIO {
  return {
    async docker(args, signal) {
      try {
        const { stdout } = await exec("docker", args, {
          cwd: repository,
          env: runtimeEnvironment(),
          signal,
          maxBuffer: 1024 * 1024,
        });
        return stdout;
      } catch {
        throw new Error("Backup Docker command failed");
      }
    },
    async dockerToFile(args, output, signal) {
      signal.throwIfAborted();
      const child = spawn("docker", args, {
        cwd: repository,
        env: runtimeEnvironment(),
        signal,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const destination = createWriteStream(output, {
        flags: "w",
        mode: 0o600,
      });
      const exit = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) =>
          code === 0 ? resolve() : reject(new Error("Backup stream failed")),
        );
      });
      try {
        await Promise.all([pipeline(child.stdout, destination), exit]);
      } catch {
        child.kill();
        destination.destroy();
        throw new Error("Backup Docker stream failed");
      }
    },
    async revision() {
      const { stdout } = await exec("git", ["rev-parse", "HEAD"], {
        cwd: repository,
        env: runtimeEnvironment(),
      });
      return stdout.trim();
    },
  };
}

export function createBackupRunner(
  repository: string,
  io: BackupIO = commandBackupIO(repository),
  lockDirectory = tmpdir(),
): BackupRunner<string[]> {
  const compose = (project: string, ...args: string[]) => [
    "compose",
    "--project-name",
    project,
    "--env-file",
    path.join(repository, ".env"),
    "--file",
    path.join(repository, "compose.yml"),
    "--file",
    path.join(repository, "compose.local.yml"),
    ...args,
  ];
  const sql = (project: string, query: string) =>
    io.docker(
      compose(
        project,
        "exec",
        "-T",
        "db",
        "sh",
        "-eu",
        "-c",
        'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -X -A -t -v ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -c "$1"',
        "anar-backup-sql",
        query,
      ),
    );
  return {
    async withSourceLock(project, operation) {
      const lock = path.join(lockDirectory, `anar-backup-${project}.lock`);
      const owner = `owner-${process.pid}-${randomUUID()}.json`;
      const startedAt = await processStart(process.pid);
      for (;;) {
        try {
          await mkdir(lock, { mode: 0o700 });
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        const owners = await readdir(lock);
        if (
          owners.length !== 1 ||
          !/^owner-\d+-[a-f0-9-]+\.json$/.test(owners[0])
        )
          throw new Error("Source backup is already locked");
        const previous = path.join(lock, owners[0]);
        const held = JSON.parse(await readFile(previous, "utf8")) as {
          pid: number;
          startedAt: string;
        };
        if (
          !Number.isInteger(held.pid) ||
          held.pid <= 0 ||
          !held.startedAt ||
          (await processStart(held.pid)) === held.startedAt
        )
          throw new Error("Source backup is already locked");
        try {
          await unlink(previous);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        await rmdir(lock);
      }
      await writeFile(
        path.join(lock, owner),
        JSON.stringify({ pid: process.pid, startedAt }),
        { flag: "wx", mode: 0o600 },
      );
      try {
        return await operation();
      } finally {
        await unlink(path.join(lock, owner));
        await rmdir(lock);
      }
    },
    async runningState(project) {
      const output = await io.docker(
        compose(project, "ps", "--status", "running", "--services"),
      );
      const services = output.split(/\r?\n/).filter(Boolean);
      if (!services.includes("db"))
        throw new Error("Source database is not running");
      return services;
    },
    async quiesce(project, signal) {
      signal.throwIfAborted();
      await io.docker(
        compose(project, "stop", "--timeout", "60", "proxy"),
        signal,
      );
      await io.docker(
        compose(project, "stop", "--timeout", "60", "api", "worker"),
        signal,
      );
    },
    async resume(project, state) {
      const services = ["api", "worker", "proxy"].filter((name) =>
        state.includes(name),
      );
      if (services.length)
        await io.docker(compose(project, "start", ...services));
    },
    async metadata(project) {
      const sourceRevision = await io.revision();
      const schemaVersion = (
        await sql(
          project,
          "SELECT COALESCE((SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1), 'none')",
        )
      ).trim();
      const counts = await sql(
        project,
        `SELECT json_build_object(${snapshotTables
          .map((table) => `'${table}', (SELECT count(*) FROM ${table})`)
          .join(", ")})`,
      );
      return {
        sourceRevision,
        schemaVersion,
        rowCounts: JSON.parse(counts) as Record<string, number>,
      };
    },
    async dump(project, output, signal) {
      await io.dockerToFile(
        compose(
          project,
          "exec",
          "-T",
          "db",
          "sh",
          "-eu",
          "-c",
          'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dump --format=custom --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"',
        ),
        output,
        signal,
      );
    },
    async archiveUploads(project, output, signal) {
      const found = await io.docker([
        "volume",
        "ls",
        "--filter",
        `label=com.docker.compose.project=${project}`,
        "--filter",
        "label=com.docker.compose.volume=uploads_data",
        "--format",
        "{{.Name}}",
      ]);
      const volumes = found.split(/\r?\n/).filter(Boolean);
      if (volumes.length !== 1)
        throw new Error("Source uploads volume not found");
      await io.dockerToFile(
        [
          "run",
          "--rm",
          "--network",
          "none",
          "--read-only",
          "--mount",
          `type=volume,source=${volumes[0]},target=/uploads,readonly`,
          "postgres:17",
          "tar",
          "--format=ustar",
          "--create",
          "--file",
          "-",
          "--directory",
          "/uploads",
          ".",
        ],
        output,
        signal,
      );
    },
    async verifyDump(file) {
      await io.docker([
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--mount",
        `type=bind,source=${path.resolve(file)},target=/backup.dump,readonly`,
        "postgres:17",
        "pg_restore",
        "--list",
        "/backup.dump",
      ]);
    },
    listArchive: listTar,
  };
}
