import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sessions, users } from "./platform.js";

export const pushEndpointBindings = pgTable(
  "push_endpoint_bindings",
  {
    endpointHash: text("endpoint_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    boundAt: timestamp("bound_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "push_endpoint_bindings_hash_check",
      sql`${table.endpointHash} ~ '^[0-9a-f]{64}$'`,
    ),
    index("push_endpoint_bindings_session_idx").on(table.sessionId),
  ],
);
