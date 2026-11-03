import { z } from "zod";
import { wireDateSchema } from "./http.js";
import type { Stage } from "./settings.js";
import {
  companySchemaSchema,
  type Field,
  type LostReason,
  type Outcome,
} from "./settings.js";

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
  byUserId: string;
  byMemberId: string | null;
  outcomeId: string;
  notes: string | null;
  happenedAt: Date;
  nextActionAt: Date | null;
  stageBeforeId: string;
  stageAfterId: string;
};
export type ApplyFollowUpInput = {
  leadId: string;
  followUpId: string;
  happenedAt: Date;
  outcomeId: string;
  countsAsFailed: boolean;
  nextActionAt: Date | null;
  stageId?: string;
  lostReasonId?: string | null;
  custom?: Record<string, string | number | null>;
};
export type ApplyFollowUpResult = {
  lead: Lead;
  suggestionEventId: string | null;
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
export type ReferenceInput =
  | { kind: "field"; fieldKey: string }
  | { kind: "stage"; stageId: string };
export type ReferenceCounts = { leadCount: number };
export type MemberLeadCounts = { openLeads: number; overdue: number };
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

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/);
export const findImportMatchesInputSchema = z.strictObject({
  phones: z
    .array(e164)
    .transform((phones) => [...new Set(phones)])
    .pipe(z.array(e164).max(500)),
});
export type FindImportMatchesInput = z.input<
  typeof findImportMatchesInputSchema
>;
export type ImportMatch = {
  leadId: string;
  phoneE164: string;
  campaignName: string | null;
  leadDate: Date;
};

export const leadFiltersSchema = z.strictObject({
  assignedTo: z.union([z.uuid(), z.literal("unassigned")]).optional(),
  priority: z.enum(["hot", "warm", "cold"]).optional(),
  stageId: z.uuid().optional(),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().max(512).optional(),
});
export type LeadFilters = z.input<typeof leadFiltersSchema>;

export const leadRowWireSchema = z.strictObject({
  id: z.uuid(),
  fullName: z.string().nullable(),
  phoneE164: z.string().nullable(),
  phoneValid: z.boolean(),
  priority: z.enum(["hot", "warm", "cold"]),
  score: z.number().int(),
  nextActionAt: wireDateSchema.nullable(),
  failedAttempts: z.number().int().nonnegative(),
  source: z.enum(["facebook", "instagram", "event", "web", "other"]).nullable(),
  leadDate: wireDateSchema,
  stage: z.strictObject({
    id: z.uuid(),
    name: z.string(),
    kind: z.enum(["open", "won", "lost"]),
  }),
  answers: z.array(z.strictObject({ key: z.string(), label: z.string() })),
  assignedAt: wireDateSchema.nullable(),
  assignee: z.strictObject({ memberId: z.uuid(), name: z.string() }).nullable(),
  bucket: z.enum(["overdue", "due_today", "new"]).nullable(),
});
export const leadPageWireSchema = z.strictObject({
  items: z.array(leadRowWireSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type LeadPage = {
  items: LeadRow[];
  nextCursor: string | null;
  total: number;
};

export type HistoryReferences = {
  fields: Field[];
  stages: Stage[];
  outcomes: Outcome[];
  lostReasons: LostReason[];
  actors: { userId: string; memberId: string | null; name: string }[];
};
export type RealLeadDetail = LeadDetail & {
  history: HistoryReferences;
  nextEventCursor: string | null;
  suggestionEventId: string | null;
};
export type LeadTimelinePage = {
  events: LeadEvent[];
  followUps: FollowUp[];
  history: HistoryReferences;
  nextCursor: string | null;
};

export const leadIdQuerySchema = z.strictObject({ leadId: z.uuid() });
export const dismissLostSuggestionInputSchema = z.strictObject({
  leadId: z.uuid(),
  suggestionEventId: z.uuid(),
});
export type DismissLostSuggestionInput = z.infer<
  typeof dismissLostSuggestionInputSchema
>;
export const leadEventsQuerySchema = z.strictObject({
  leadId: z.uuid(),
  cursor: z.string().max(512).optional(),
});
export type LeadEventsQuery = z.input<typeof leadEventsQuerySchema>;

const priority = z.enum(["hot", "warm", "cold"]);
const nullableDate = wireDateSchema.nullable();
export const leadWireSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  fullName: z.string().nullable(),
  phoneE164: z.string().nullable(),
  phoneRaw: z.string().nullable(),
  phoneValid: z.boolean(),
  email: z.string().nullable(),
  source: z.enum(["facebook", "instagram", "event", "web", "other"]).nullable(),
  sourceKind: z.enum(["import", "manual", "api"]),
  externalId: z.string().nullable(),
  leadDate: wireDateSchema,
  campaignName: z.string().nullable(),
  formName: z.string().nullable(),
  assignedTo: z.uuid().nullable(),
  stageId: z.uuid(),
  lostReasonId: z.uuid().nullable(),
  custom: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  score: z.number().int(),
  priority,
  scoreBreakdown: z.record(z.string(), z.number()),
  scoredAt: wireDateSchema,
  nextActionAt: nullableDate,
  lastContactedAt: nullableDate,
  failedAttempts: z.number().int().nonnegative(),
  lostSuggestedAt: nullableDate,
  importBatchId: z.uuid().nullable(),
  mergedIntoId: z.uuid().nullable(),
  deletedAt: nullableDate,
  createdAt: wireDateSchema,
});
export const leadEventWireSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  leadId: z.uuid(),
  type: z.enum([
    "imported",
    "duplicate_import",
    "assigned",
    "unassigned",
    "stage_changed",
    "follow_up_logged",
    "fields_updated",
    "score_changed",
    "lost_suggested",
    "lost_suggestion_dismissed",
    "merged",
    "note_added",
    "created_manually",
  ]),
  actorMemberId: z.uuid().nullable(),
  actorUserId: z.uuid(),
  data: z.record(z.string(), z.unknown()),
  createdAt: wireDateSchema,
});
export const followUpWireSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  leadId: z.uuid(),
  byUserId: z.uuid(),
  byMemberId: z.uuid().nullable(),
  outcomeId: z.uuid(),
  notes: z.string().nullable(),
  happenedAt: wireDateSchema,
  nextActionAt: nullableDate,
  stageBeforeId: z.uuid(),
  stageAfterId: z.uuid(),
});
export const historyReferencesWireSchema = companySchemaSchema.extend({
  actors: z.array(
    z.strictObject({
      userId: z.uuid(),
      memberId: z.uuid().nullable(),
      name: z.string(),
    }),
  ),
});
export const leadDetailWireSchema = z.strictObject({
  lead: leadWireSchema,
  hotMin: z.number().int(),
  fields: z.array(
    z.strictObject({ key: z.string(), label: z.string(), value: z.string() }),
  ),
  followUps: z.array(followUpWireSchema),
  events: z.array(leadEventWireSchema),
  duplicates: z.tuple([]),
  history: historyReferencesWireSchema,
  nextEventCursor: z.string().nullable(),
  suggestionEventId: z.uuid().nullable(),
});
export const leadTimelinePageWireSchema = z.strictObject({
  events: z.array(leadEventWireSchema),
  followUps: z.array(followUpWireSchema),
  history: historyReferencesWireSchema,
  nextCursor: z.string().nullable(),
});

const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const updateLeadFieldsInputSchema = z
  .strictObject({
    leadId: z.uuid(),
    fullName: z.string().trim().min(1).max(200).nullable().optional(),
    phoneRaw: z.string().trim().min(1).max(64).nullable().optional(),
    email: z.email().max(320).nullable().optional(),
    custom: z
      .record(
        fieldKey,
        z.union([z.string().max(2000), z.number().finite(), z.null()]),
      )
      .optional(),
  })
  .refine(
    (input) =>
      input.fullName !== undefined ||
      input.phoneRaw !== undefined ||
      input.email !== undefined ||
      (input.custom !== undefined && Object.keys(input.custom).length > 0),
    "Change at least one value",
  );
export type UpdateLeadFieldsInput = z.input<typeof updateLeadFieldsInputSchema>;
export type FieldsUpdatedData = {
  keys: string[];
  systemKeys: ("fullName" | "phoneRaw" | "email")[];
};
export type ScoreChangedData = { from: Priority; to: Priority; score: number };
export const updateLeadFieldsResultWireSchema = z.strictObject({
  lead: leadWireSchema,
});

export const changeStageInputSchema = z.strictObject({
  leadId: z.uuid(),
  stageId: z.uuid(),
  lostReasonId: z.uuid().nullable().optional(),
  suggestionEventId: z.uuid().optional(),
});
export type ChangeStageInput = z.input<typeof changeStageInputSchema>;
export type StageChangedData = {
  from: string;
  to: string;
  fromKind: "open" | "won" | "lost";
  toKind: "open" | "won" | "lost";
  lostReasonId: string | null;
};

export type TodayResult = {
  overdue: LeadRow[];
  dueToday: LeadRow[];
  newLeads: LeadRow[];
  counts: TodayCounts;
  hasAssignedLeads: boolean;
  nextCursors: {
    overdue: string | null;
    dueToday: string | null;
    newLeads: string | null;
  };
};
export type BucketPage = {
  items: LeadRow[];
  nextCursor: string | null;
  total: number;
};
export const bucketQuerySchema = z.strictObject({
  bucket: z.enum(["overdue", "due_today", "new"]),
  cursor: z.string().max(512).optional(),
});
export type BucketQuery = z.input<typeof bucketQuerySchema>;
export const memberIdQuerySchema = z.strictObject({ memberId: z.uuid() });
const todayCount = z.number().int().nonnegative();
export const bucketCountsWireSchema = z.strictObject({
  overdue: todayCount,
  dueToday: todayCount,
  newLeads: todayCount,
});
export const todayResultWireSchema = z.strictObject({
  overdue: z.array(leadRowWireSchema),
  dueToday: z.array(leadRowWireSchema),
  newLeads: z.array(leadRowWireSchema),
  counts: bucketCountsWireSchema.extend({
    callsToday: todayCount,
    callsTarget: todayCount.nullable(),
    siteVisitsToday: todayCount,
    bookingsToday: todayCount,
    nextDueAt: wireDateSchema.nullable(),
  }),
  hasAssignedLeads: z.boolean(),
  nextCursors: z.strictObject({
    overdue: z.string().nullable(),
    dueToday: z.string().nullable(),
    newLeads: z.string().nullable(),
  }),
});
export const bucketPageWireSchema = leadPageWireSchema;
