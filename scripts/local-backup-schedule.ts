import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { BackupManifest } from "./backup/manifest.ts";
import { backupSchedule, inspectRetention } from "./backup/retention.ts";
import { backupLocal } from "./local-backup.ts";
import { createBackupRunner } from "./local-backup-runner.ts";

const exec = promisify(execFile);
const repository = fileURLToPath(new URL("../", import.meta.url));

function stateRoot(home = homedir()): string {
  return path.join(home, "Library", "Application Support", "Anar");
}

function recordFile(root: string, project: string): string {
  return path.join(root, "backup-status", `${project}.jsonl`);
}

export async function readLastSuccess(
  root: string,
  project: string,
): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(recordFile(root, project), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const lines = content.trimEnd().split("\n");
  const last = lines.at(-1);
  if (!last) return null;
  try {
    const value = JSON.parse(last) as { at?: unknown };
    return typeof value.at === "string" ? value.at : null;
  } catch {
    return null;
  }
}

export async function runBackupTick(input: {
  project: string;
  repository: string;
  root: string;
  now: Date;
  timezone: string;
  signal: AbortSignal;
  backup(input: {
    repository: string;
    output: string;
    project: string;
    signal: AbortSignal;
  }): Promise<{ directory: string; manifest: BackupManifest }>;
}): Promise<{ ran: boolean; overdue: boolean; retentionCandidates: number }> {
  const { project, root, now, timezone } = input;
  if (!/^[a-z][a-z0-9-]{2,39}$/.test(project))
    throw new Error("Local project name is invalid");
  const last = await readLastSuccess(root, project);
  const schedule = backupSchedule(now, timezone, last);
  if (!schedule.due)
    return { ran: false, overdue: schedule.overdue, retentionCandidates: 0 };
  const output = path.join(root, "backups", project);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const saved = await input.backup({
    repository: input.repository,
    output,
    project,
    signal: input.signal,
  });
  const statusDir = path.dirname(recordFile(root, project));
  await mkdir(statusDir, { recursive: true, mode: 0o700 });
  await appendFile(
    recordFile(root, project),
    `${JSON.stringify({ at: saved.manifest.createdAt })}\n`,
    { mode: 0o600 },
  );
  const retention = await inspectRetention(output, saved.directory, timezone);
  return {
    ran: true,
    overdue: false,
    retentionCandidates: retention.candidates.length,
  };
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function agentPlist(
  project: string,
  node: string,
  script: string,
): string {
  const label = `com.anar.local-backup.${project}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>
<string>${xml(node)}</string><string>${xml(script)}</string>
<string>tick</string><string>--project</string><string>${xml(project)}</string>
</array>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>0</integer></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><false/>
</dict></plist>\n`;
}

export async function installBackupAgent(
  project: string,
  home = homedir(),
  launch: (args: string[]) => Promise<void> = async (args) => {
    await exec("launchctl", args);
  },
): Promise<void> {
  if (!/^[a-z][a-z0-9-]{2,39}$/.test(project))
    throw new Error("Local project name is invalid");
  const label = `com.anar.local-backup.${project}`;
  const agent = path.join(home, "Library", "LaunchAgents", `${label}.plist`);
  await mkdir(path.dirname(agent), { recursive: true, mode: 0o700 });
  await writeFile(
    agent,
    agentPlist(project, process.execPath, fileURLToPath(import.meta.url)),
    { mode: 0o600 },
  );
  const domain = `gui/${process.getuid?.() ?? 0}`;
  await launch(["bootout", `${domain}/${label}`]).catch(() => {});
  await launch(["bootstrap", domain, agent]);
}

export async function stopBackupAgent(
  project: string,
  launch: (args: string[]) => Promise<void> = async (args) => {
    await exec("launchctl", args);
  },
): Promise<void> {
  if (!/^[a-z][a-z0-9-]{2,39}$/.test(project))
    throw new Error("Local project name is invalid");
  const label = `com.anar.local-backup.${project}`;
  const domain = `gui/${process.getuid?.() ?? 0}`;
  await launch(["bootout", `${domain}/${label}`]).catch(() => {});
}

if (import.meta.main) {
  const [action, flag, value] = process.argv.slice(2);
  const project = flag === "--project" && value ? value : "anar-local";
  try {
    if (action === "tick") {
      const controller = new AbortController();
      process.once("SIGTERM", () => controller.abort());
      process.once("SIGINT", () => controller.abort());
      const result = await runBackupTick({
        project,
        repository,
        root: stateRoot(),
        now: new Date(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        signal: controller.signal,
        backup: (source) =>
          backupLocal({
            ...source,
            now: () => new Date(),
            runner: createBackupRunner(source.repository),
          }),
      });
      process.stdout.write(
        result.ran
          ? `Backup complete; ${result.retentionCandidates} retention candidates kept\n`
          : "Backup current\n",
      );
    } else if (action === "status") {
      const last = await readLastSuccess(stateRoot(), project);
      const schedule = backupSchedule(
        new Date(),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        last,
      );
      process.stdout.write(
        `${last ?? "never"}: ${schedule.overdue ? "overdue" : "current"}\n`,
      );
    } else throw new Error("Unknown backup schedule action");
  } catch {
    process.stderr.write("Local backup schedule failed\n");
    process.exitCode = 1;
  }
}
