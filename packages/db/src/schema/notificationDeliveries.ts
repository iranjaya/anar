import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { at, companyColumns, companyPolicies } from "./companyRows.js";
import { notifications } from "./notifications.js";
import { pushSubscriptions } from "./pushSubscriptions.js";

export type DeliveryState =
  | "pending"
  | "sending"
  | "sent"
  | "skipped"
  | "failed"
  | "indeterminate";

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    ...companyColumns(),
    notificationId: uuid("notification_id").notNull(),
    channel: text("channel").notNull().$type<"push" | "email">(),
    targetKey: text("target_key").notNull(),
    subscriptionId: uuid("subscription_id"),
    state: text("state").notNull().$type<DeliveryState>(),
    attempts: integer("attempts").notNull().default(0),
    leaseUntil: at("lease_until"),
    firstAttemptAt: at("first_attempt_at"),
    expiresAt: at("expires_at").notNull(),
    deliveredAt: at("delivered_at"),
    encryptedMessage: text("encrypted_message"),
    messageHash: text("message_hash"),
  },
  (table) => [
    check(
      "notification_deliveries_state_check",
      sql`${table.channel} IN ('push', 'email') AND ${table.state} IN ('pending', 'sending', 'sent', 'skipped', 'failed', 'indeterminate') AND ${table.attempts} BETWEEN 0 AND 4`,
    ),
    check(
      "notification_deliveries_target_check",
      sql`(${table.channel} = 'push' AND (${table.targetKey} = 'none' OR ${table.targetKey} = ${table.subscriptionId}::text)) OR (${table.channel} = 'email' AND ${table.targetKey} = 'email' AND ${table.subscriptionId} IS NULL)`,
    ),
    unique("notification_deliveries_target_key").on(
      table.companyId,
      table.notificationId,
      table.channel,
      table.targetKey,
    ),
    foreignKey({
      columns: [table.companyId, table.notificationId],
      foreignColumns: [notifications.companyId, notifications.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.subscriptionId],
      foreignColumns: [pushSubscriptions.companyId, pushSubscriptions.id],
    }).onDelete("restrict"),
    index("notification_deliveries_open_idx").on(
      table.companyId,
      table.notificationId,
      table.state,
    ),
    ...companyPolicies("notification_deliveries", table.companyId),
  ],
);
