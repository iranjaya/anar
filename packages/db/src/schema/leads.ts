import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { at, companyColumns, companyPolicies } from "./companyRows.js";
import { companyMembers } from "./members.js";
import { lostReasons, stages } from "./settings.js";

export const leads = pgTable(
  "leads",
  {
    ...companyColumns(),
    fullName: text("full_name"),
    phoneE164: text("phone_e164"),
    phoneRaw: text("phone_raw"),
    phoneValid: boolean("phone_valid").notNull(),
    email: text("email"),
    source: text("source").$type<
      "facebook" | "instagram" | "event" | "web" | "other"
    >(),
    sourceKind: text("source_kind")
      .notNull()
      .$type<"import" | "manual" | "api">(),
    externalId: text("external_id"),
    leadDate: at("lead_date").notNull(),
    campaignName: text("campaign_name"),
    formName: text("form_name"),
    assignedTo: uuid("assigned_to"),
    stageId: uuid("stage_id").notNull(),
    lostReasonId: uuid("lost_reason_id"),
    custom: jsonb("custom")
      .notNull()
      .$type<Record<string, string | number | null>>(),
    score: integer("score").notNull(),
    priority: text("priority").notNull().$type<"hot" | "warm" | "cold">(),
    scoreBreakdown: jsonb("score_breakdown")
      .notNull()
      .$type<Record<string, number>>(),
    scoredAt: at("scored_at").notNull(),
    nextActionAt: at("next_action_at"),
    lastContactedAt: at("last_contacted_at"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lostSuggestedAt: at("lost_suggested_at"),
    // The FK to import batches lands with L2, once that table exists.
    importBatchId: uuid("import_batch_id"),
    mergedIntoId: uuid("merged_into_id"),
    deletedAt: at("deleted_at"),
  },
  (table) => [
    check(
      "leads_source_check",
      sql`${table.source} IN ('facebook', 'instagram', 'event', 'web', 'other')`,
    ),
    check(
      "leads_source_kind_check",
      sql`${table.sourceKind} IN ('import', 'manual', 'api')`,
    ),
    check(
      "leads_priority_check",
      sql`${table.priority} IN ('hot', 'warm', 'cold')`,
    ),
    check("leads_failed_attempts_check", sql`${table.failedAttempts} >= 0`),
    unique("leads_company_id_key").on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.stageId],
      foreignColumns: [stages.companyId, stages.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.lostReasonId],
      foreignColumns: [lostReasons.companyId, lostReasons.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.assignedTo],
      foreignColumns: [companyMembers.companyId, companyMembers.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.mergedIntoId],
      foreignColumns: [table.companyId, table.id] as [AnyPgColumn, AnyPgColumn],
    }).onDelete("restrict"),
    uniqueIndex("leads_live_phone_idx")
      .on(table.companyId, table.phoneE164)
      .where(
        sql`${table.phoneE164} IS NOT NULL AND ${table.mergedIntoId} IS NULL AND ${table.deletedAt} IS NULL`,
      ),
    uniqueIndex("leads_external_id_idx")
      .on(table.companyId, table.externalId)
      .where(sql`${table.externalId} IS NOT NULL`),
    index("leads_assignee_next_action_idx").on(
      table.companyId,
      table.assignedTo,
      table.nextActionAt,
    ),
    index("leads_stage_idx").on(table.companyId, table.stageId),
    index("leads_lead_date_idx").on(
      table.companyId,
      table.leadDate.desc(),
      table.id.asc(),
    ),
    index("leads_priority_idx").on(table.companyId, table.priority),
    index("leads_custom_idx").using("gin", table.custom.op("jsonb_path_ops")),
    index("leads_name_trgm_idx").using(
      "gin",
      table.fullName.op("gin_trgm_ops"),
    ),
    index("leads_phone_prefix_idx").on(
      table.companyId,
      table.phoneE164.op("text_pattern_ops"),
    ),
    ...companyPolicies("leads", table.companyId),
  ],
).enableRLS();
