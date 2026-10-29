import { tz } from "@date-fns/tz";
import { isSameDay } from "date-fns";
import type { Stage } from "@/modules/settings/types";
import type { Bucket, Lead } from "./types";

type BucketInput = Pick<Lead, "nextActionAt" | "assignedTo"> & {
  stageKind: Stage["kind"];
  assignedAt: Date | null;
  followUpCount: number;
};

export function bucketOf(
  lead: BucketInput,
  now: Date,
  timezone: string,
): Bucket | null {
  if (lead.assignedTo === null || lead.stageKind !== "open") return null;
  if (lead.nextActionAt !== null) {
    if (lead.nextActionAt < now) return "overdue";
    if (isSameDay(lead.nextActionAt, now, { in: tz(timezone) })) {
      return "due_today";
    }
  }
  if (
    lead.assignedAt !== null &&
    lead.assignedAt <= now &&
    now.getTime() - lead.assignedAt.getTime() < 24 * 60 * 60 * 1000 &&
    lead.followUpCount === 0
  ) {
    return "new";
  }
  return null;
}
