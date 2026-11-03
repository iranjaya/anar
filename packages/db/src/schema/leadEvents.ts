import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { companyColumns, companyPolicies } from "./companyRows.js";
import { leads } from "./leads.js";
import { companyMembers } from "./members.js";
import { users } from "./platform.js";

type LeadEventData =
  | { batchId: string; rowNo: number }
  | {
      batchId: string;
      rowNo: number;
      campaignName: string | null;
      leadDate: string;
    }
  | { keys: string[]; systemKeys: ("fullName" | "phoneRaw" | "email")[] }
  | {
      from: "hot" | "warm" | "cold";
      to: "hot" | "warm" | "cold";
      score: number;
    }
  | {
      from: string;
      to: string;
      fromKind: "open" | "won" | "lost";
      toKind: "open" | "won" | "lost";
      lostReasonId: string | null;
    }
  | { assignmentId: string; from: string | null; to: string | null }
  | { followUpId: string; outcomeId: string }
  | { followUpId: string; failedAttempts: number }
  | { suggestionEventId: string };

export const leadEvents = pgTable(
  "lead_events",
  {
    ...companyColumns(),
    leadId: uuid("lead_id").notNull(),
    type: text("type")
      .notNull()
      .$type<
        | "imported"
        | "duplicate_import"
        | "fields_updated"
        | "score_changed"
        | "stage_changed"
        | "assigned"
        | "unassigned"
        | "follow_up_logged"
        | "lost_suggested"
        | "lost_suggestion_dismissed"
      >(),
    actorMemberId: uuid("actor_member_id"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    data: jsonb("data").notNull().$type<LeadEventData>(),
  },
  (table) => [
    check(
      "lead_events_type_check",
      sql`${table.type} IN ('imported', 'duplicate_import', 'fields_updated', 'score_changed', 'stage_changed', 'assigned', 'unassigned', 'follow_up_logged', 'lost_suggested', 'lost_suggestion_dismissed')`,
    ),
    foreignKey({
      columns: [table.companyId, table.leadId],
      foreignColumns: [leads.companyId, leads.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.actorMemberId],
      foreignColumns: [companyMembers.companyId, companyMembers.id],
    }).onDelete("restrict"),
    index("lead_events_lead_idx").on(
      table.leadId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("lead_events_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    ...companyPolicies("lead_events", table.companyId),
  ],
).enableRLS();
