import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { at, companyColumns, companyPolicies } from "./companyRows.js";
import { leads } from "./leads.js";
import { companyMembers } from "./members.js";
import { users } from "./platform.js";
import { outcomes, stages } from "./settings.js";

export const followUps = pgTable(
  "follow_ups",
  {
    ...companyColumns(),
    leadId: uuid("lead_id").notNull(),
    byMemberId: uuid("by_member_id"),
    byUserId: uuid("by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    outcomeId: uuid("outcome_id").notNull(),
    notes: text("notes"),
    happenedAt: at("happened_at").notNull(),
    nextActionAt: at("next_action_at"),
    stageBeforeId: uuid("stage_before_id").notNull(),
    stageAfterId: uuid("stage_after_id").notNull(),
    countsAsFailed: boolean("counts_as_failed").notNull(),
    isSiteVisit: boolean("is_site_visit").notNull(),
    requestId: uuid("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").notNull().$type<Record<string, unknown>>(),
  },
  (table) => [
    check("follow_ups_notes_length_check", sql`length(${table.notes}) <= 2000`),
    unique("follow_ups_company_id_key").on(table.companyId, table.id),
    unique("follow_ups_request_key").on(
      table.companyId,
      table.byUserId,
      table.requestId,
    ),
    foreignKey({
      columns: [table.companyId, table.leadId],
      foreignColumns: [leads.companyId, leads.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.byMemberId],
      foreignColumns: [companyMembers.companyId, companyMembers.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.outcomeId],
      foreignColumns: [outcomes.companyId, outcomes.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.stageBeforeId],
      foreignColumns: [stages.companyId, stages.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.stageAfterId],
      foreignColumns: [stages.companyId, stages.id],
    }).onDelete("restrict"),
    index("follow_ups_lead_time_idx").on(
      table.companyId,
      table.leadId,
      table.happenedAt.desc(),
      table.id.desc(),
    ),
    index("follow_ups_member_time_idx").on(
      table.companyId,
      table.byMemberId,
      table.happenedAt.desc(),
      table.id.desc(),
    ),
    ...companyPolicies("follow_ups", table.companyId),
  ],
).enableRLS();
