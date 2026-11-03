import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  installBackupAgent,
  stopBackupAgent,
} from "./local-backup-schedule.ts";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const required = [
  "POSTGRES_PASSWORD",
  "APP_DATABASE_PASSWORD",
  "MIGRATION_DATABASE_PASSWORD",
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "ANAR_LAN_BIND_ADDRESS",
  "ANAR_SITE_ADDRESS",
  "PUBLIC_ORIGIN",
  "EMAIL_TRANSPORT",
  "EMAIL_FROM",
  "RESEND_API_KEY",
  "MAIL_ENCRYPTION_KEY",
  "OTP_PEPPER",
  "ANAR_PUSH_ENABLED",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const;
const assignment = /^([A-Z][A-Z0-9_]*)=(.*)$/;

export function missingEnvNames(contents: string): string[] {
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    const match = assignment.exec(line);
    if (!match) continue;
    values.set(match[1], match[2].trim());
  }
  return required.filter((name) => {
    const value = values.get(name) ?? "";
    return !value || value === '""' || value === "''" || value.startsWith("#");
  });
}

export type ComposeRun = (args: string[]) => Promise<void>;
export async function localCompose(
  action: "up" | "down",
  directory: string,
  project: string,
  compose: ComposeRun,
): Promise<string[]> {
  if (!/^[a-z][a-z0-9-]{2,39}$/.test(project))
    throw new Error("Local project name is invalid");
  const envPath = path.join(directory, ".env");
  if (action === "up") {
    let contents = "";
    try {
      contents = await readFile(envPath, "utf8");
    } catch {
      return [...required];
    }
    const missing = missingEnvNames(contents);
    if (missing.length) return missing;
  }
  const base = [
    "compose",
    "--project-name",
    project,
    "--env-file",
    envPath,
    "--file",
    path.join(directory, "compose.yml"),
    "--file",
    path.join(directory, "compose.local.yml"),
  ];
  if (action === "down") {
    await compose([...base, "down", "--remove-orphans"]);
    return [];
  }
  await compose([...base, "config", "--quiet"]);
  await compose([...base, "up", "--detach", "--wait", "db"]);
  await compose([...base, "run", "--build", "--rm", "migrate"]);
  await compose([
    ...base,
    "up",
    "--build",
    "--detach",
    "--wait",
    "api",
    "worker",
    "web",
    "proxy",
  ]);
  return [];
}

async function docker(args: string[]): Promise<void> {
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
  try {
    await run("docker", args, {
      cwd: root,
      env,
      timeout: 600_000,
      maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new Error("Local Compose command failed");
  }
}

if (import.meta.main) {
  const [action, flag, value] = process.argv.slice(2);
  if (action !== "up" && action !== "down") {
    process.stderr.write("Use local:up or local:down\n");
    process.exitCode = 1;
  } else {
    const project = flag === "--project" && value ? value : "anar-local";
    try {
      if (action === "down") await stopBackupAgent(project);
      const missing = await localCompose(action, root, project, docker);
      if (missing.length) {
        for (const name of missing) process.stderr.write(`${name}: missing\n`);
        process.exitCode = 1;
      } else {
        if (action === "up") await installBackupAgent(project);
        process.stdout.write(`local:${action} complete\n`);
      }
    } catch {
      process.stderr.write(`local:${action} failed\n`);
      process.exitCode = 1;
    }
  }
}
