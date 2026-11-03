import { sql } from "drizzle-orm";
import { check, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { at, companyColumns, companyPolicies } from "./companyRows.js";
import { sessions, users } from "./platform.js";

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    ...companyColumns(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    endpoint: text("endpoint").notNull(),
    endpointHash: text("endpoint_hash").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    expiresAt: at("expires_at"),
    disabledAt: at("disabled_at"),
  },
  (table) => [
    check(
      "push_subscriptions_text_check",
      sql`char_length(${table.endpoint}) BETWEEN 1 AND 1024 AND ${table.endpointHash} ~ '^[0-9a-f]{64}$'`,
    ),
    unique("push_subscriptions_company_id_key").on(table.companyId, table.id),
    unique("push_subscriptions_session_endpoint_key").on(
      table.companyId,
      table.sessionId,
      table.endpointHash,
    ),
    index("push_subscriptions_user_idx").on(table.companyId, table.userId),
    ...companyPolicies("push_subscriptions", table.companyId),
  ],
);
