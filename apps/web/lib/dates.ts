import { TZDateMini, tz } from "@date-fns/tz";
import { differenceInCalendarDays, differenceInHours, format } from "date-fns";

export function localDateAfterDays(
  now: Date,
  days: number,
  timezone: string,
): string {
  const local = new TZDateMini(now.getTime(), timezone);
  local.setDate(local.getDate() + days);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function localDateAtTen(date: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(
    new TZDateMini(year, month - 1, day, 10, 0, 0, timezone).getTime(),
  );
}

export function formatClock(date: Date, timezone: string): string {
  return format(date, "HH:mm", { in: tz(timezone) });
}

export function formatDay(
  date: Date,
  timezone: string,
  now: Date = new Date(),
): string {
  const local = { in: tz(timezone) };
  const days = differenceInCalendarDays(date, now, local);
  let day = format(date, "d MMM yyyy", local);
  if (days === -1) day = "Yesterday";
  if (days === 0) day = "Today";
  if (days === 1) day = "Tomorrow";
  return `${day} ${formatClock(date, timezone)}`;
}

export function formatDue(
  date: Date,
  timezone: string,
  now: Date = new Date(),
): string {
  if (date < now) {
    const hours = Math.max(1, differenceInHours(now, date));
    if (hours < 24) return `Overdue ${hours} ${hours === 1 ? "hour" : "hours"}`;
    const days = Math.floor(hours / 24);
    return `Overdue ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (differenceInCalendarDays(date, now, { in: tz(timezone) }) === 0) {
    return `Due ${formatClock(date, timezone)}`;
  }
  return `Due ${formatDay(date, timezone, now)}`;
}
