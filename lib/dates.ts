import { tz } from "@date-fns/tz";
import { differenceInCalendarDays, differenceInHours, format } from "date-fns";

const kathmandu = { in: tz("Asia/Kathmandu") };

export function formatClock(date: Date): string {
  return format(date, "HH:mm", kathmandu);
}

export function formatDay(date: Date, now: Date = new Date()): string {
  const days = differenceInCalendarDays(date, now, kathmandu);
  let day = format(date, "d MMM yyyy", kathmandu);
  if (days === -1) day = "Yesterday";
  if (days === 0) day = "Today";
  if (days === 1) day = "Tomorrow";
  return `${day} ${formatClock(date)}`;
}

export function formatDue(date: Date, now: Date = new Date()): string {
  if (date < now) {
    const hours = Math.max(1, differenceInHours(now, date));
    if (hours < 24) return `Overdue ${hours} ${hours === 1 ? "hour" : "hours"}`;
    const days = Math.floor(hours / 24);
    return `Overdue ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (differenceInCalendarDays(date, now, kathmandu) === 0) {
    return `Due ${formatClock(date)}`;
  }
  return `Due ${formatDay(date, now)}`;
}
