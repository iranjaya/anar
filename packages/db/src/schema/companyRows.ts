import { type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  pgPolicy,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./platform.js";

export const at = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 3 });

export function companyColumns() {
  return {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  };
}

// Company scope alone is not enough: the parent company must also belong to the scoped agency.
export function companyPolicies(table: string, companyId: AnyPgColumn) {
  const scope: SQL = sql`current_setting('app.scope_kind', true) = 'company'
    AND ${companyId} = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = ${companyId}
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )`;
  return [
    pgPolicy(`${table}_select`, {
      for: "select",
      to: "anar_app",
      using: scope,
    }),
    pgPolicy(`${table}_insert`, {
      for: "insert",
      to: "anar_app",
      withCheck: scope,
    }),
    pgPolicy(`${table}_update`, {
      for: "update",
      to: "anar_app",
      using: scope,
      withCheck: scope,
    }),
  ];
}
