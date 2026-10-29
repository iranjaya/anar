import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { companies, users } from "./platform.js";

export const companyMembers = pgTable(
  "company_members",
  {
    id: uuid("id").primaryKey(),
    agencyId: uuid("agency_id").notNull(),
    companyId: uuid("company_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    role: text("role").notNull().$type<"super_admin" | "admin">(),
    status: text("status")
      .notNull()
      .$type<"invited" | "active" | "deactivated">(),
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
    const scope = sql`current_setting('app.scope_kind', true) = 'company' AND ${table.agencyId} = NULLIF(current_setting('app.agency_id', true), '')::uuid AND ${table.companyId} = NULLIF(current_setting('app.company_id', true), '')::uuid`;
    const identity = sql`current_setting('app.scope_kind', true) = 'identity' AND ${table.userId} = NULLIF(current_setting('app.user_id', true), '')::uuid`;
    return [
      check(
        "company_members_role_check",
        sql`${table.role} IN ('super_admin', 'admin')`,
      ),
      check(
        "company_members_status_check",
        sql`${table.status} IN ('invited', 'active', 'deactivated')`,
      ),
      unique("company_members_company_user_key").on(
        table.companyId,
        table.userId,
      ),
      unique("company_members_company_id_key").on(table.companyId, table.id),
      index("company_members_user_idx").on(table.userId),
      foreignKey({
        columns: [table.agencyId, table.companyId],
        foreignColumns: [companies.agencyId, companies.id],
      }).onDelete("restrict"),
      pgPolicy("company_members_select", {
        for: "select",
        to: "anar_app",
        using: sql`(${scope}) OR (${identity})`,
      }),
      pgPolicy("company_members_insert", {
        for: "insert",
        to: "anar_app",
        withCheck: scope,
      }),
      pgPolicy("company_members_update", {
        for: "update",
        to: "anar_app",
        using: scope,
        withCheck: scope,
      }),
      pgPolicy("company_members_delete", {
        for: "delete",
        to: "anar_app",
        using: scope,
      }),
    ];
  },
).enableRLS();
