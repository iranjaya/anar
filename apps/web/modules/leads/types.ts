import type { Stage } from "@/modules/settings/types";

export type Priority = "hot" | "warm" | "cold";
export type Lead = {
  id: string;
  companyId: string;
  fullName: string | null;
  phoneE164: string | null;
  phoneRaw: string | null;
  phoneValid: boolean;
  email: string | null;
  source: "facebook" | "instagram" | "event" | "web" | "other" | null;
  sourceKind: "import" | "manual" | "api";
  externalId: string | null;
  leadDate: Date;
  campaignName: string | null;
  formName: string | null;
  assignedTo: string | null;
  stageId: string;
  lostReasonId: string | null;
  custom: Record<string, string | number | null>;
  score: number;
  priority: Priority;
  scoreBreakdown: Record<string, number>;
  scoredAt: Date;
  nextActionAt: Date | null;
  lastContactedAt: Date | null;
  failedAttempts: number;
  lostSuggestedAt: Date | null;
  importBatchId: string | null;
  mergedIntoId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
};
export type FollowUp = {
  id: string;
  companyId: string;
  leadId: string;
  byMemberId: string;
  outcomeId: string;
  notes: string | null;
  happenedAt: Date;
  nextActionAt: Date | null;
  stageBeforeId: string;
  stageAfterId: string;
};
export type LeadEventType =
  | "imported"
  | "duplicate_import"
  | "assigned"
  | "unassigned"
  | "stage_changed"
  | "follow_up_logged"
  | "fields_updated"
  | "score_changed"
  | "lost_suggested"
  | "lost_suggestion_dismissed"
  | "merged"
  | "note_added"
  | "created_manually";
export type LeadEvent = {
  id: string;
  companyId: string;
  leadId: string;
  type: LeadEventType;
  actorMemberId: string | null;
  actorUserId: string;
  data: Record<string, unknown>;
  createdAt: Date;
};
export type Bucket = "overdue" | "due_today" | "new";
export type LeadRow = Pick<
  Lead,
  | "id"
  | "fullName"
  | "phoneE164"
  | "phoneValid"
  | "priority"
  | "score"
  | "nextActionAt"
  | "failedAttempts"
  | "source"
  | "leadDate"
> & {
  stage: Pick<Stage, "id" | "name" | "kind">;
  answers: { key: string; label: string }[];
  assignedAt: Date | null;
  assignee: { memberId: string; name: string } | null;
  bucket: Bucket | null;
};
export type LeadDetail = {
  lead: Lead;
  hotMin: number;
  fields: { key: string; label: string; value: string }[];
  followUps: FollowUp[];
  events: LeadEvent[];
  duplicates: [];
};
export type TodayCounts = {
  overdue: number;
  dueToday: number;
  newLeads: number;
  callsToday: number;
  callsTarget: number | null;
  siteVisitsToday: number;
  bookingsToday: number;
  nextDueAt: Date | null;
};
