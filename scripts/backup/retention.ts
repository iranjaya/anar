import { readdir } from "node:fs/promises";
import path from "node:path";
import { verifyBackup } from "./manifest.ts";

type CompleteSet = { directory: string; createdAt: string };

function localDay(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function monday(day: string): string {
  const at = new Date(`${day}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
  return at.toISOString().slice(0, 10);
}

export function retentionCandidates(
  sets: CompleteSet[],
  timezone: string,
): string[] {
  const sorted = [...sets].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      a.directory.localeCompare(b.directory),
  );
  const days = new Set<string>();
  const weeks = new Set<string>();
  const keep = new Set<string>();
  for (const set of sorted) {
    const day = localDay(new Date(set.createdAt), timezone);
    const week = monday(day);
    if (!days.has(day) && days.size < 7) {
      days.add(day);
      keep.add(set.directory);
    }
    if (!weeks.has(week) && weeks.size < 4) {
      weeks.add(week);
      keep.add(set.directory);
    }
  }
  return sorted
    .filter((set) => !keep.has(set.directory))
    .map((set) => set.directory);
}

export async function inspectRetention(
  root: string,
  completed: string,
  timezone: string,
): Promise<{ candidates: string[]; incomplete: number }> {
  await verifyBackup(completed);
  const sets: CompleteSet[] = [];
  let incomplete = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("backup-")) continue;
    const directory = path.join(root, entry.name);
    try {
      sets.push({
        directory,
        createdAt: (await verifyBackup(directory)).createdAt,
      });
    } catch {
      incomplete++;
    }
  }
  return {
    candidates: retentionCandidates(sets, timezone).filter(
      (directory) => path.resolve(directory) !== path.resolve(completed),
    ),
    incomplete,
  };
}

export function backupSchedule(
  at: Date,
  timezone: string,
  lastSuccess: string | null,
): { due: boolean; overdue: boolean } {
  const last = lastSuccess === null ? NaN : Date.parse(lastSuccess);
  const valid = Number.isFinite(last) && last <= at.getTime();
  const overdue = !valid || at.getTime() - last >= 86_400_000;
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(at),
  );
  const doneToday =
    valid && localDay(new Date(last), timezone) === localDay(at, timezone);
  return { overdue, due: overdue || (hour >= 2 && !doneToday) };
}
