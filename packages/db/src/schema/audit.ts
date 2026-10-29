import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agencies } from "./agencies.js";
import { companies, users } from "./platform.js";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey(),
    agencyId: uuid("agency_id").references(() => agencies.id, {
      onDelete: "restrict",
    }),
    companyId: uuid("company_id"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    data: jsonb("data").notNull().$type<Record<string, string>>(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.agencyId, table.companyId],
      foreignColumns: [companies.agencyId, companies.id],
    }).onDelete("restrict"),
    check(
      "audit_log_company_agency_check",
      sql`${table.companyId} IS NULL OR ${table.agencyId} IS NOT NULL`,
    ),
    index("audit_log_agency_time_idx").on(
      table.agencyId,
      table.createdAt,
      table.id,
    ),
    index("audit_log_company_time_idx").on(
      table.companyId,
      table.createdAt,
      table.id,
    ),
    index("audit_log_actor_time_idx").on(
      table.actorUserId,
      table.createdAt,
      table.id,
    ),
  ],
);
