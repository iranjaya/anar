import { tz } from "@date-fns/tz";
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { store } from "@/mock/access";
import type { Range, Target } from "../types";

export function targetRange(
  period: Target["period"],
  now: Date,
  timezone: string,
): Range {
  const local = { in: tz(timezone) };
  if (period === "week")
    return {
      from: startOfWeek(now, { ...local, weekStartsOn: 1 }),
      to: endOfWeek(now, { ...local, weekStartsOn: 1 }),
    };
  if (period === "month")
    return { from: startOfMonth(now, local), to: endOfMonth(now, local) };
  return { from: startOfDay(now, local), to: endOfDay(now, local) };
}

export async function readTargets(
  companyId: string,
  now: Date,
): Promise<Target[]> {
  const data = await store();
  return data.targets.filter(
    (target) =>
      target.companyId === companyId &&
      target.startsOn <= now &&
      (target.endsOn === null || target.endsOn >= now),
  );
}
