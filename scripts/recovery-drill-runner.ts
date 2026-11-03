import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { backupLocal } from "./local-backup.ts";
import {
  type BackupIO,
  commandBackupIO,
  createBackupRunner,
  snapshotTables,
} from "./local-backup-runner.ts";
import { restoreLocal } from "./local-restore.ts";
import {
  commandRestoreIO,
  createRestoreRunner,
  type RestoreConfiguration,
  type RestoreIO,
} from "./local-restore-runner.ts";
import {
  type RecoveryDrillRunner,
  runRecoveryDrill,
} from "./recovery-drill.ts";

const { chromium, expect } = createRequire(import.meta.url)(
  "../apps/web/node_modules/@playwright/test",
) as typeof import("../apps/web/node_modules/@playwright/test/index.js");

export type DrillIO = RestoreIO & Pick<BackupIO, "dockerToFile" | "revision">;
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1),
  manager = id(2),
  agency = id(3),
  company = id(4),
  member = id(5),
  stage = id(6),
  outcome = id(7);
const email = "restore-manager@example.test";
const forbiddenPorts = new Set([3000, 3001, 3100, 3317, 8080]);
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

export function createProofKeys(): {
  OTP_PEPPER: string;
  MAIL_ENCRYPTION_KEY: string;
} {
  return {
    OTP_PEPPER: randomBytes(32).toString("base64"),
    MAIL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  };
}

function requireProof(project: string): void {
  if (!/^anar-(proof|restore)-[a-z0-9][a-z0-9-]{0,49}$/.test(project))
    throw new Error("Invalid disposable project");
}

async function until<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = await read();
    if (ready(result)) return result;
    await setTimeout(250);
  }
  throw new Error(`Drill timeout at ${label}`);
}

export function createRecoveryDrillRunner(options: {
  repository: string;
  configuration: RestoreConfiguration;
  io?: DrillIO;
  request?: typeof fetch;
  report?(step: string): void;
}): RecoveryDrillRunner {
  const { repository, configuration } = options;
  const request = options.request ?? fetch;
  const io = options.io ?? {
    ...commandBackupIO(repository),
    ...commandRestoreIO(repository),
  };
  const ownedProjects = new Set<string>();
  const ownedMarkers = new Map<string, string[]>();
  const compose = (project: string, ...args: string[]) => {
    requireProof(project);
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
  const remap = (args: string[]) => {
    if (args[0] !== "compose") return args;
    const project = args[args.indexOf("--project-name") + 1];
    const lastFile = args.lastIndexOf("--file");
    return compose(project, ...args.slice(lastFile + 2));
  };
  const backupRunner = createBackupRunner(repository, {
    docker: (args) => io.docker(remap(args)),
    dockerToFile: (args, output, signal) =>
      io.dockerToFile(remap(args), output, signal),
    revision: io.revision,
  });
  const restoreRunner = createRestoreRunner(
    repository,
    {
      ...io,
      async docker(args, env) {
        const result = await io.docker(args, env);
        if (args[0] === "create") {
          const project = args
            .find((arg) => arg.startsWith("anar.restore.project="))
            ?.slice("anar.restore.project=".length);
          const name = args[args.indexOf("--name") + 1];
          if (project && name)
            ownedMarkers.set(project, [
              ...(ownedMarkers.get(project) ?? []),
              name,
            ]);
        }
        return result;
      },
    },
    undefined,
    configuration,
  );
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
        "anar-proof-sql",
        query,
      ),
    );
  const port = async (project: string, service: string, internal: string) => {
    const found = (
      await io.docker(compose(project, "port", service, internal))
    ).trim();
    options.report?.(
      `proof ${service} binding: ${/^[0-9.:[\]a-f]+$/i.test(found) ? found : "unavailable"}`,
    );
    const match = /^127\.0\.0\.1:(\d+)$/.exec(found);
    if (!match || forbiddenPorts.has(Number(match[1])))
      throw new Error("Unsafe proof port");
    return `http://${found}`;
  };
  const token = randomBytes(32).toString("base64url");
  const cookie = `anar_session=${token}`;
  let batchId = "";
  let leadId = "";
  const api = async (
    project: string,
    route: string,
    body: object | FormData,
  ) => {
    const origin = await port(project, "proxy", "80");
    const response = await request(`${origin}${route}`, {
      method: "POST",
      headers: {
        origin,
        cookie,
        ...(body instanceof FormData
          ? {}
          : { "content-type": "application/json" }),
      },
      body: body instanceof FormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const result = (await response.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    if (!response.ok || !result.ok)
      throw new Error(`Drill API failed at ${route} (${response.status})`);
    return result.data;
  };
  return {
    async assertDisposable(project) {
      requireProof(project);
      for (const args of [
        [
          "ps",
          "-aq",
          "--filter",
          `label=com.docker.compose.project=${project}`,
        ],
        [
          "volume",
          "ls",
          "-q",
          "--filter",
          `label=com.docker.compose.project=${project}`,
        ],
      ])
        if ((await io.docker(args)).trim())
          throw new Error("Disposable project is occupied");
      for (const args of [
        ["ps", "-a", "--format", "{{.Names}}"],
        ["volume", "ls", "--format", "{{.Name}}"],
        ["network", "ls", "--format", "{{.Name}}"],
      ]) {
        const names = (await io.docker(args)).split(/\r?\n/);
        if (
          names.some(
            (name) =>
              name === project ||
              name.startsWith(`${project}_`) ||
              name.startsWith(`${project}-`),
          )
        )
          throw new Error("Disposable project is occupied");
      }
    },
    async preparePausedImport(project) {
      if (!project.startsWith("anar-proof-"))
        throw new Error("Source must be anar-proof");
      const reservationToken = randomUUID();
      await io.docker([
        "create",
        "--name",
        `${project}_proof_reservation`,
        "--network",
        "none",
        "--label",
        `anar.proof.project=${project}`,
        "postgres:17",
        "true",
      ]);
      ownedMarkers.set(project, [`${project}_proof_reservation`]);
      for (const kind of ["postgres_data", "uploads_data"]) {
        const name = `${project}_${kind}`;
        await io.docker([
          "volume",
          "create",
          "--label",
          `com.docker.compose.project=${project}`,
          "--label",
          `com.docker.compose.volume=${kind}`,
          "--label",
          `anar.proof.token=${reservationToken}`,
          name,
        ]);
        const found = await io.docker([
          "volume",
          "inspect",
          "--format",
          '{{ index .Labels "anar.proof.token" }}',
          name,
        ]);
        if (found.trim() !== reservationToken)
          throw new Error("Source proof volume is occupied");
      }
      ownedProjects.add(project);
      options.report?.("building disposable source");
      await io.docker(
        compose(project, "build", "migrate", "api", "worker", "web"),
      );
      await io.docker(
        compose(project, "up", "--detach", "--wait", "db", "mailpit"),
      );
      await io.docker(compose(project, "run", "--rm", "migrate"));
      await sql(
        project,
        `INSERT INTO users(id,email,name,platform_role) VALUES ('${owner}','restore-owner@example.test','Synthetic Owner','owner'),('${manager}','${email}','Synthetic Manager',NULL);
        INSERT INTO agencies(id,name,slug,status,created_by) VALUES ('${agency}','Synthetic Agency','restore-agency','active','${owner}');
        INSERT INTO companies(id,agency_id,name,slug,status,default_country,timezone,settings) VALUES ('${company}','${agency}','Restore Company','restore-company','active','NP','Asia/Kathmandu','{"super_admin_can_import":true}');
        INSERT INTO company_members(id,agency_id,company_id,user_id,name,role,status) VALUES ('${member}','${agency}','${company}','${manager}','Synthetic Manager','super_admin','active');
        INSERT INTO stages(id,company_id,name,position,kind,is_default) VALUES ('${stage}','${company}','New Lead',0,'open',true);
        INSERT INTO outcomes(id,company_id,name,position,counts_as_failed) VALUES ('${outcome}','${company}','Reached customer',0,false);
        INSERT INTO scoring_configs(id,company_id,version,base_points,hot_min,warm_min,rules,active,created_by) VALUES ('${id(8)}','${company}',1,10,70,40,'[]',true,'${manager}');
        INSERT INTO sessions(id,user_id,token_hash,device_label,user_agent,ip,last_seen_at,expires_at,last_otp_at) VALUES ('${id(9)}','${manager}','${digest(token)}','Synthetic drill','Synthetic drill','127.0.0.1',now(),now()+interval '7 days',now());
        CREATE FUNCTION public.drill_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.row_no = 501 THEN PERFORM pg_sleep(600); END IF; RETURN NEW; END $$;
        CREATE TRIGGER drill_pause BEFORE INSERT ON import_rows FOR EACH ROW EXECUTE FUNCTION public.drill_pause();`,
      );
      options.report?.("starting source runtime");
      await io.docker(compose(project, "up", "--detach", "--wait", "web"));
      options.report?.("source web started");
      await io.docker(compose(project, "up", "--no-deps", "--detach", "proxy"));
      options.report?.("source proxy started");
      const origin = await port(project, "proxy", "80");
      options.report?.("source proxy port verified");
      await io.docker(
        compose(
          project,
          "up",
          "--no-deps",
          "--detach",
          "--wait",
          "api",
          "worker",
        ),
        { ANAR_RESTORE_PUBLIC_ORIGIN: origin },
      );
      options.report?.("source API and worker started");
      await until(
        async () => {
          try {
            return (await request(`${origin}/api/health`)).ok;
          } catch {
            return false;
          }
        },
        Boolean,
        "source health",
      );
      await until(
        () => sql(project, "SELECT count(*) FROM worker_heartbeats"),
        (value) => Number(value) > 0,
        "source worker readiness",
      );
      const lines = Array.from(
        { length: 501 },
        (_, i) =>
          `Synthetic Lead ${i + 1},+1${["202", "212", "213", "312", "415", "617"][Math.floor(i / 100)]}55501${String(i % 100).padStart(2, "0")}`,
      );
      const upload = new FormData();
      options.report?.("uploading synthetic 501-row import");
      upload.set(
        "file",
        new Blob([["full_name,phone", ...lines, ""].join("\n")], {
          type: "text/csv",
        }),
        "synthetic-drill.csv",
      );
      batchId = String(
        (await api(project, "/api/imports?company=restore-company", upload))
          .batchId,
      );
      assert.match(batchId, /^[0-9a-f-]{36}$/);
      const draft = {
        batchId,
        mapping: [
          { header: "full_name", target: "system:full_name" },
          { header: "phone", target: "system:phone" },
        ],
        newFields: [],
        expectedRevision: 0,
      };
      const check = await api(
        project,
        "/api/companies/restore-company/imports/dryRunImport",
        draft,
      );
      await api(
        project,
        "/api/companies/restore-company/imports/commitImport",
        {
          ...draft,
          expectedRevision: check.previewRevision,
          previewRevision: check.previewRevision,
        },
      );
      await until(
        () =>
          sql(
            project,
            `SELECT last_row_no FROM import_batches WHERE id='${batchId}'`,
          ),
        (value) => Number(value) === 500,
        "row 500",
      );
      await io.docker(compose(project, "kill", "worker"));
      options.report?.("source paused at row 500");
      await sql(
        project,
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep' AND pid<>pg_backend_pid()",
      );
      await until(
        () =>
          sql(
            project,
            "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%drill_pause%' AND wait_event='PgSleep'",
          ),
        (value) => Number(value) === 0,
        "worker disconnect",
      );
      await sql(
        project,
        `DROP TRIGGER drill_pause ON import_rows; DROP FUNCTION public.drill_pause();
        UPDATE pgboss.job SET state='failed' WHERE id=(SELECT job_id FROM import_runs WHERE batch_id='${batchId}');`,
      );
      leadId = (
        await sql(
          project,
          `SELECT id FROM leads WHERE import_batch_id='${batchId}' ORDER BY id LIMIT 1`,
        )
      ).trim();
      await sql(
        project,
        `UPDATE leads SET assigned_to='${member}',next_action_at=now()-interval '1 hour' WHERE id='${leadId}';`,
      );
      await api(
        project,
        "/api/companies/restore-company/followups/logFollowUp",
        {
          requestId: randomUUID(),
          leadId,
          outcomeId: outcome,
          notes: "Synthetic restored timeline",
        },
      );
      // Queued OTP mail is encrypted before backup and can only reach the local fake mailbox.
      await api(project, "/api/auth/requestOtp", { email });
      return { processed: 500, totalRows: 501 };
    },
    async sourceState(project) {
      requireProof(project);
      const running = await io.docker(
        compose(project, "ps", "--status", "running", "--services"),
      );
      if (running.split(/\s+/).includes("worker"))
        throw new Error("Source worker must stay stopped");
      const data = await sql(
        project,
        `SELECT json_build_object(${snapshotTables.map((table) => `'${table}',(SELECT md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) FROM ${table} t)`).join(",")})`,
      );
      const files = await io.docker([
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--mount",
        `type=volume,source=${project}_uploads_data,target=/uploads,readonly`,
        "postgres:17",
        "sh",
        "-eu",
        "-c",
        "find /uploads -type f -exec sha256sum {} + | sort",
      ]);
      return { databaseSha256: digest(data), uploadsSha256: digest(files) };
    },
    backup: (project, output) => {
      options.report?.("backing up coordinated database and uploads");
      return backupLocal({
        project,
        output,
        repository,
        signal: new AbortController().signal,
        now: () => new Date(),
        runner: backupRunner,
      });
    },
    restore: async (directory, project) => {
      options.report?.("restoring isolated target");
      await restoreLocal({
        directory,
        project,
        signal: new AbortController().signal,
        runner: {
          ...restoreRunner,
          async reserveEmptyTarget(target) {
            await restoreRunner.reserveEmptyTarget(target);
            ownedProjects.add(target);
          },
        },
      });
    },
    async resumeImport(project) {
      options.report?.("resuming restored import");
      const origin = await port(project, "proxy", "80");
      await until(
        async () => {
          try {
            return (await request(`${origin}/api/health`)).ok;
          } catch {
            return false;
          }
        },
        Boolean,
        "restored health",
      );
      await api(
        project,
        "/api/companies/restore-company/imports/resumeImport",
        { batchId },
      );
      await until(
        () =>
          sql(
            project,
            `SELECT status FROM import_batches WHERE id='${batchId}'`,
          ),
        (value) => value.trim() === "done",
        "restored import completion",
      );
      const output = await sql(
        project,
        `SELECT json_build_object('ledgerRows',count(*),'distinctRowNumbers',count(DISTINCT row_no),'importedEvents',(SELECT count(*) FROM lead_events WHERE type='imported' AND data->>'batchId'='${batchId}')) FROM import_rows WHERE batch_id='${batchId}'`,
      );
      return JSON.parse(output);
    },
    async checkBrowser(project, width, output) {
      options.report?.(`checking restored browser ${width}`);
      const baseURL = await port(project, "proxy", "80");
      const mailURL = await port(project, "mailpit", "8025");
      await until(
        async () => {
          try {
            return (await request(`${baseURL}/login`)).ok;
          } catch {
            return false;
          }
        },
        Boolean,
        "restored web readiness",
      );
      await mkdir(output, { recursive: true, mode: 0o700 });
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({
          baseURL,
          viewport:
            width === "phone"
              ? { width: 390, height: 844 }
              : { width: 1440, height: 900 },
          isMobile: width === "phone",
        });
        const before = (
          await (await fetch(`${mailURL}/api/v1/messages`)).json()
        ).messages.map((item: { ID: string }) => item.ID) as string[];
        await page.goto("/login");
        await page.getByLabel("Email address").fill(email);
        await page
          .getByRole("button", { name: "Send code", exact: true })
          .click();
        const code = await until(
          async () => {
            const messages = (
              await (await fetch(`${mailURL}/api/v1/messages`)).json()
            ).messages as { ID: string; To: { Address: string }[] }[];
            for (const message of messages) {
              if (
                before.includes(message.ID) ||
                !message.To.some((to) => to.Address === email)
              )
                continue;
              const body = await (
                await fetch(`${mailURL}/api/v1/message/${message.ID}`)
              ).json();
              const match = String(body.Text).match(/\b\d{6}\b/);
              if (match) return match[0];
            }
            return "";
          },
          Boolean,
          "restored OTP",
        );
        await page.getByLabel("Six-digit code").fill(code);
        await page.getByRole("button", { name: "Verify and sign in" }).click();
        await expect(page).not.toHaveURL(/\/login/);
        for (const [label, route] of [
          ["timeline", `/restore-company/leads/${leadId}`],
          ["today", "/restore-company/today"],
          ["report", `/restore-company/imports/${batchId}`],
        ]) {
          await page.goto(route);
          if (label === "timeline")
            await expect(
              page.getByText("Synthetic restored timeline"),
            ).toBeVisible();
          if (label === "today")
            await expect(
              page.getByRole("heading", {
                name: "My Leads Today",
                exact: true,
              }),
            ).toBeVisible();
          if (label === "report")
            await expect(
              page.getByRole("heading", {
                name: "Import complete",
                exact: true,
              }),
            ).toBeVisible();
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
          );
          await page.screenshot({
            path: path.join(output, `${width}-${label}.png`),
            fullPage: true,
          });
        }
      } finally {
        await browser.close();
      }
    },
    async stopDisposableContainers(project) {
      requireProof(project);
      if (ownedProjects.has(project))
        await io.docker(compose(project, "down", "--remove-orphans"));
      const markers = ownedMarkers.get(project) ?? [];
      if (markers.length) await io.docker(["rm", ...markers]);
    },
  };
}

if (import.meta.main) {
  const overlay = process.argv[2];
  if (!overlay) throw new Error("Provide the reviewed proof overlay path");
  const repository = path.resolve(import.meta.dirname, "..");
  const base = path.join(
    homedir(),
    "Library",
    "Application Support",
    "Anar",
    "recovery-proofs",
  );
  await mkdir(base, { recursive: true, mode: 0o700 });
  const output = await mkdtemp(path.join(base, "drill-"));
  const suffix = randomUUID();
  const sourceProject = `anar-proof-${suffix}`;
  const targetProject = `anar-restore-${suffix}`;
  const bootstrapPassword = randomBytes(24).toString("hex");
  const appPassword = randomBytes(24).toString("hex");
  const migrationPassword = randomBytes(24).toString("hex");
  const envFile = path.join(output, "proof-runtime");
  await writeFile(
    envFile,
    Object.entries({
      POSTGRES_DB: "anar",
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: bootstrapPassword,
      APP_DATABASE_PASSWORD: appPassword,
      MIGRATION_DATABASE_PASSWORD: migrationPassword,
      DATABASE_URL: `postgresql://anar_app:${appPassword}@db:5432/anar`,
      MIGRATION_DATABASE_URL: `postgresql://anar_migrate:${migrationPassword}@db:5432/anar`,
      ...createProofKeys(),
      ANAR_PROOF_IMAGE_PREFIX: sourceProject,
      ANAR_ENV: "local",
      ANAR_AUTH_ENABLED: "true",
      EMAIL_TRANSPORT: "mailpit",
      EMAIL_FROM: "restore@example.test",
      MAILPIT_URL: "http://mailpit:8025",
      ANAR_PUSH_ENABLED: "false",
      ANAR_LOCAL_HTTP: "true",
      PUBLIC_ORIGIN: "http://127.0.0.1",
    })
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    { flag: "wx", mode: 0o600 },
  );
  try {
    const runner = createRecoveryDrillRunner({
      repository,
      configuration: {
        envFile,
        composeFiles: [
          path.join(repository, "compose.yml"),
          path.join(repository, "compose.restore.yml"),
          path.resolve(overlay),
        ],
      },
      report: (step) => process.stdout.write(`drill: ${step}\n`),
    });
    const result = await runRecoveryDrill({
      sourceProject,
      targetProject,
      backupOutput: output,
      browserOutput: path.join(output, "browser"),
      runner,
      monotonicMs: () => performance.now(),
    });
    process.stdout.write(
      `${JSON.stringify({ ...result, sourceProject, targetProject, evidence: output })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Recovery drill failed"}\n`,
    );
    process.stdout.write(`Evidence preserved: ${output}\n`);
    process.exitCode = 1;
  }
}
