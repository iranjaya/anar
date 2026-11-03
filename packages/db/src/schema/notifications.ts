import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { at, companyColumns, companyPolicies } from "./companyRows.js";
import { users } from "./platform.js";

type NotificationType =
  | "import_complete"
  | "assigned"
  | "lost_suggested"
  | "overdue"
  | "daily"
  | "weekly";

export const notifications = pgTable(
  "notifications",
  {
    ...companyColumns(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: text("type").notNull().$type<NotificationType>(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url").notNull(),
    data: jsonb("data")
      .notNull()
      .$type<{ type: NotificationType } & Record<string, unknown>>(),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: at("read_at"),
    pushedAt: at("pushed_at"),
    emailedAt: at("emailed_at"),
  },
  (table) => [
    check(
      "notifications_type_check",
      sql`${table.type} IN ('import_complete', 'assigned', 'lost_suggested', 'overdue', 'daily', 'weekly') AND ${table.data}->>'type' = ${table.type}`,
    ),
    check(
      "notifications_text_check",
      sql`char_length(${table.title}) BETWEEN 1 AND 160 AND char_length(${table.body}) BETWEEN 1 AND 500 AND char_length(${table.dedupeKey}) BETWEEN 1 AND 240`,
    ),
    unique("notifications_user_key").on(table.userId, table.dedupeKey),
    unique("notifications_company_id_key").on(table.companyId, table.id),
    index("notifications_inbox_idx").on(
      table.companyId,
      table.userId,
      table.readAt,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    ...companyPolicies("notifications", table.companyId),
  ],
);
