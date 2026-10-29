import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./platform.js";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    actorRole: text("actor_role")
      .notNull()
      .$type<"dna" | "super_admin" | "admin">(),
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
