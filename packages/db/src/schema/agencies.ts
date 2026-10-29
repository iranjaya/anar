import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./platform.js";

export const agencies = pgTable(
  "agencies",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    status: text("status")
      .notNull()
      .$type<"pending" | "active" | "suspended" | "closing">(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "agencies_status_check",
      sql`${table.status} IN ('pending', 'active', 'suspended', 'closing')`,
    ),
    index("agencies_created_idx").on(table.createdAt, table.id),
  ],
);

export const agencyMembers = pgTable(
  "agency_members",
  {
    id: uuid("id").primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().$type<"active" | "deactivated">(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    deactivatedAt: timestamp("deactivated_at", {
      withTimezone: true,
      precision: 3,
    }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    const agencyScope = sql`current_setting('app.scope_kind', true) IN ('agency', 'company') AND ${table.agencyId} = NULLIF(current_setting('app.agency_id', true), '')::uuid`;
    const ownIdentity = sql`current_setting('app.scope_kind', true) = 'identity' AND ${table.userId} = NULLIF(current_setting('app.user_id', true), '')::uuid`;
    return [
      check(
        "agency_members_status_check",
        sql`${table.status} IN ('active', 'deactivated')`,
      ),
      uniqueIndex("agency_members_agency_id_idx").on(table.agencyId, table.id),
      index("agency_members_agency_status_idx").on(
        table.agencyId,
        table.status,
      ),
      index("agency_members_agency_created_idx").on(
        table.agencyId,
        table.createdAt,
        table.id,
      ),
      pgPolicy("agency_members_select", {
        for: "select",
        to: "anar_app",
        using: sql`(${agencyScope}) OR (${ownIdentity})`,
      }),
      pgPolicy("agency_members_insert", {
        for: "insert",
        to: "anar_app",
        withCheck: agencyScope,
      }),
      pgPolicy("agency_members_update", {
        for: "update",
        to: "anar_app",
        using: agencyScope,
        withCheck: agencyScope,
      }),
      pgPolicy("agency_members_delete", {
        for: "delete",
        to: "anar_app",
        using: agencyScope,
      }),
    ];
  },
).enableRLS();
