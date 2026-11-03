import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { validateArchive } from "./backup/archive.ts";
import { listTar } from "./backup/tar.ts";
import { snapshotTables } from "./local-backup-runner.ts";
import type { RestoreRunner } from "./local-restore.ts";

const exec = promisify(execFile);
const tenantTables = [
  "agency_members",
  "companies",
  "company_members",
  "notifications",
  "fields",
  "stages",
  "outcomes",
  "lost_reasons",
  "leads",
  "scoring_configs",
  "lead_events",
  "import_batches",
  "import_rows",
  "mapping_templates",
  "push_subscriptions",
  "notification_deliveries",
  "import_runs",
  "follow_ups",
  "company_job_periods",
];

export type RestoreIO = {
  docker(args: string[], env?: Record<string, string>): Promise<string>;
  dockerFromFile(args: string[], file: string): Promise<void>;
};
export type RestoreConfiguration = { envFile: string; composeFiles: string[] };

function requireRestoreProject(project: string): void {
  if (!/^anar-restore-[a-z0-9][a-z0-9-]{0,49}$/.test(project))
    throw new Error("Invalid restore project");
}

function runtimeEnvironment(
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...extra };
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

export function commandRestoreIO(repository: string): RestoreIO {
  return {
    async docker(args, env) {
      try {
        const result = await exec("docker", args, {
          cwd: repository,
          env: runtimeEnvironment(env),
          maxBuffer: 1024 * 1024,
        });
        return result.stdout;
      } catch {
        throw new Error("Restore Docker command failed");
      }
    },
    async dockerFromFile(args, file) {
      const child = spawn("docker", args, {
        cwd: repository,
        env: runtimeEnvironment(),
        stdio: ["pipe", "ignore", "ignore"],
      });
      const exit = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) =>
          code === 0 ? resolve() : reject(new Error("Restore stream failed")),
        );
      });
      try {
        await Promise.all([
          pipeline(createReadStream(file), child.stdin),
          exit,
        ]);
      } catch {
        child.kill();
        throw new Error("Restore Docker stream failed");
      }
    },
  };
}

export function createRestoreRunner(
  repository: string,
  io: RestoreIO = commandRestoreIO(repository),
  lockDirectory = tmpdir(),
  configuration: RestoreConfiguration = {
    envFile: path.join(repository, ".env"),
    composeFiles: [
      path.join(repository, "compose.yml"),
      path.join(repository, "compose.restore.yml"),
    ],
  },
): RestoreRunner {
  const volume = (project: string, kind: "postgres_data" | "uploads_data") => {
    requireRestoreProject(project);
    return `${project}_${kind}`;
  };
  const compose = (project: string, ...args: string[]) => {
    requireRestoreProject(project);
    return [
      "compose",
      "--project-name",
      project,
      "--env-file",
      configuration.envFile,
      ...configuration.composeFiles.flatMap((file) => ["--file", file]),
      ...args,
    ];
  };
  const psql = (project: string, query: string) =>
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
        "anar-restore-sql",
        query,
      ),
    );
  const expectOk = async (project: string, query: string) => {
    if ((await psql(project, query)).trim() !== "ok")
      throw new Error("Restored database verification failed");
  };
  return {
    async withTargetLock(project, operation) {
      requireRestoreProject(project);
      const lock = path.join(lockDirectory, `anar-restore-${project}.lock`);
      try {
        await mkdir(lock, { mode: 0o700 });
      } catch {
        throw new Error("Restore target is already locked");
      }
      try {
        return await operation();
      } finally {
        await rmdir(lock);
      }
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
    async reserveEmptyTarget(project) {
      requireRestoreProject(project);
      const [
        composeContainers,
        restoreContainers,
        namedContainers,
        projectVolumes,
        volumes,
        networks,
      ] = await Promise.all([
        io.docker([
          "ps",
          "--all",
          "--filter",
          `label=com.docker.compose.project=${project}`,
          "--format",
          "{{.Names}}",
        ]),
        io.docker([
          "ps",
          "--all",
          "--filter",
          `label=anar.restore.project=${project}`,
          "--format",
          "{{.Names}}",
        ]),
        io.docker(["ps", "--all", "--format", "{{.Names}}"]),
        io.docker([
          "volume",
          "ls",
          "--filter",
          `label=com.docker.compose.project=${project}`,
          "--format",
          "{{.Name}}",
        ]),
        io.docker(["volume", "ls", "--format", "{{.Name}}"]),
        io.docker([
          "network",
          "ls",
          "--filter",
          `label=com.docker.compose.project=${project}`,
          "--format",
          "{{.Name}}",
        ]),
      ]);
      const names = volumes.split(/\r?\n/);
      if (
        composeContainers.trim() ||
        restoreContainers.trim() ||
        projectVolumes.trim() ||
        networks.trim() ||
        namedContainers
          .split(/\r?\n/)
          .some(
            (name) =>
              name === project ||
              name.startsWith(`${project}-`) ||
              name.startsWith(`${project}_`),
          ) ||
        names.includes(volume(project, "postgres_data")) ||
        names.includes(volume(project, "uploads_data")) ||
        names.some((name) => name.startsWith(`${project}_`))
      )
        throw new Error("Restore target is occupied");
      const token = randomUUID();
      await io.docker([
        "create",
        "--name",
        `${project}_restore_reservation`,
        "--network",
        "none",
        "--label",
        `anar.restore.project=${project}`,
        "--label",
        "anar.restore.state=incomplete",
        "postgres:17",
        "true",
      ]);
      for (const kind of ["postgres_data", "uploads_data"] as const) {
        const name = volume(project, kind);
        await io.docker([
          "volume",
          "create",
          "--label",
          `com.docker.compose.project=${project}`,
          "--label",
          `com.docker.compose.volume=${kind}`,
          "--label",
          `anar.restore.token=${token}`,
          name,
        ]);
        const found = await io.docker([
          "volume",
          "inspect",
          "--format",
          '{{ index .Labels "anar.restore.token" }}',
          name,
        ]);
        if (found.trim() !== token)
          throw new Error("Restore target volume was occupied");
      }
    },
    async bootstrapRoles(project) {
      await io.docker(
        compose(project, "up", "--no-build", "--detach", "--wait", "db"),
      );
      await io.docker(
        compose(
          project,
          "exec",
          "-T",
          "db",
          "sh",
          "-eu",
          "-c",
          'export PGPASSWORD="$POSTGRES_PASSWORD"; exec /docker-entrypoint-initdb.d/10-anar-bootstrap.sh',
        ),
      );
    },
    async restoreDatabase(project, file, options) {
      if (options.role !== "anar_migrate" || !options.noOwner || !options.noAcl)
        throw new Error("Unsafe database restore options");
      await io.dockerFromFile(
        compose(
          project,
          "exec",
          "-T",
          "db",
          "sh",
          "-eu",
          "-c",
          'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_restore --format=custom --no-owner --no-acl --role=anar_migrate --exit-on-error --single-transaction --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"',
        ),
        file,
      );
    },
    async applyRuntimeGrants(project) {
      await io.dockerFromFile(
        compose(
          project,
          "exec",
          "-T",
          "db",
          "sh",
          "-eu",
          "-c",
          'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -X -v ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --file=-',
        ),
        path.join(repository, "ops/postgres/restore-grants.sql"),
      );
    },
    async extractUploads(project, file) {
      validateArchive(await listTar(file));
      const identity = (
        await io.docker(
          compose(
            project,
            "run",
            "--rm",
            "--no-deps",
            "--entrypoint",
            "sh",
            "api",
            "-eu",
            "-c",
            'printf "%s:%s\\n" "$(id -u node)" "$(id -g node)"',
          ),
        )
      ).trim();
      if (!/^[1-9][0-9]*:[0-9]+$/.test(identity))
        throw new Error("Invalid API upload owner");
      await io.docker([
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--mount",
        `type=volume,source=${volume(project, "uploads_data")},target=/uploads`,
        "--mount",
        `type=bind,source=${path.resolve(file)},target=/uploads.tar,readonly`,
        "postgres:17",
        "sh",
        "-eu",
        "-c",
        'if find /uploads -mindepth 1 -print -quit | grep -q .; then exit 1; fi; tar --extract --file /uploads.tar --directory /uploads --no-same-owner --no-same-permissions --keep-old-files; chown -R -- "$1" /uploads',
        "anar-restore-uploads",
        identity,
      ]);
    },
    async readRowCounts(project, tables) {
      if (
        tables.length === 0 ||
        tables.some(
          (table) =>
            !snapshotTables.includes(table as (typeof snapshotTables)[number]),
        )
      )
        throw new Error("Unknown backup count table");
      const output = await psql(
        project,
        `SELECT json_build_object(${tables
          .map((table) => `'${table}', (SELECT count(*) FROM ${table})`)
          .join(", ")})`,
      );
      return JSON.parse(output) as Record<string, number>;
    },
    async verifyRelationshipsAndStoredState(project) {
      await expectOk(
        project,
        `SELECT CASE WHEN
          NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f' AND NOT convalidated)
          AND NOT EXISTS (SELECT 1 FROM lead_events e LEFT JOIN leads l
            ON l.company_id = e.company_id AND l.id = e.lead_id WHERE l.id IS NULL)
          AND NOT EXISTS (SELECT 1 FROM follow_ups f LEFT JOIN leads l
            ON l.company_id = f.company_id AND l.id = f.lead_id WHERE l.id IS NULL)
          AND NOT EXISTS (SELECT 1 FROM sessions WHERE token_hash = '')
          AND NOT EXISTS (SELECT 1 FROM notification_deliveries
            WHERE channel = 'email' AND state IN ('pending','sending','sent','indeterminate')
              AND encrypted_message IS NULL
              AND NOT (state = 'pending' AND attempts = 0
                AND first_attempt_at IS NULL AND lease_until IS NULL AND message_hash IS NULL))
          THEN 'ok' ELSE 'bad' END`,
      );
    },
    async verifyRestrictedAccess(project) {
      await expectOk(
        project,
        `SELECT CASE WHEN
          NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anar_app','anar_migrate')
            AND (rolsuper OR rolbypassrls))
          AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname IN (${tenantTables.map((name) => `'${name}'`).join(",")})) = ${tenantTables.length}
          AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname IN (${tenantTables.map((name) => `'${name}'`).join(",")})
              AND NOT c.relforcerowsecurity)
          AND NOT has_table_privilege('anar_app', 'public.users', 'DELETE')
          AND NOT has_table_privilege('anar_app', 'public.follow_ups', 'UPDATE')
          AND NOT has_table_privilege('anar_app', 'public.audit_log', 'UPDATE')
          AND NOT has_table_privilege('anar_app', 'public.company_job_periods', 'DELETE')
          AND has_table_privilege('anar_app', 'pgboss.job', 'INSERT')
          THEN 'ok' ELSE 'bad' END`,
      );
    },
    async startIsolated(project, options) {
      if (options.email !== "fake" || options.push !== "disabled")
        throw new Error("Unsafe restore startup options");
      await io.docker(
        compose(
          project,
          "up",
          "--no-build",
          "--detach",
          "--wait",
          "mailpit",
          "web",
        ),
      );
      await io.docker(
        compose(project, "up", "--no-build", "--no-deps", "--detach", "proxy"),
      );
      const portOutput = await io.docker(
        compose(project, "port", "proxy", "80"),
      );
      const match = /^127\.0\.0\.1:(\d+)\s*$/.exec(portOutput);
      if (!match || [3000, 3001, 3100, 3317, 8080].includes(Number(match[1])))
        throw new Error("Restore proxy port is not allowed");
      await io.docker(
        compose(
          project,
          "up",
          "--no-build",
          "--no-deps",
          "--detach",
          "--wait",
          "api",
          "worker",
        ),
        { ANAR_RESTORE_PUBLIC_ORIGIN: `http://127.0.0.1:${match[1]}` },
      );
    },
    async markVerified(project, manifest) {
      requireRestoreProject(project);
      await io.docker([
        "create",
        "--name",
        `${project}_restore_verified`,
        "--network",
        "none",
        "--label",
        `anar.restore.project=${project}`,
        "--label",
        "anar.restore.state=verified",
        "--label",
        `anar.restore.source=${manifest.sourceRevision}`,
        "--label",
        `anar.restore.schema=${manifest.schemaVersion}`,
        "postgres:17",
        "true",
      ]);
    },
  };
}
