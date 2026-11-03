import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { at, companyColumns, companyPolicies } from "./companyRows.js";

export const fields = pgTable(
  "fields",
  {
    ...companyColumns(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type")
      .notNull()
      .$type<"text" | "number" | "date" | "dropdown">(),
    options: jsonb("options").$type<{ value: string; label: string }[]>(),
    isSystem: boolean("is_system").notNull(),
    position: integer("position").notNull(),
    archivedAt: at("archived_at"),
  },
  (table) => [
    check(
      "fields_type_check",
      sql`${table.type} IN ('text', 'number', 'date', 'dropdown')`,
    ),
    check(
      "fields_options_check",
      sql`(${table.type} = 'dropdown') = (${table.options} IS NOT NULL)`,
    ),
    check("fields_position_check", sql`${table.position} >= 0`),
    unique("fields_company_key_key").on(table.companyId, table.key),
    unique("fields_company_id_key").on(table.companyId, table.id),
    ...companyPolicies("fields", table.companyId),
  ],
).enableRLS();

export const stages = pgTable(
  "stages",
  {
    ...companyColumns(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    kind: text("kind").notNull().$type<"open" | "won" | "lost">(),
    isDefault: boolean("is_default").notNull(),
    seedKey: text("seed_key"),
    archivedAt: at("archived_at"),
  },
  (table) => [
    check("stages_kind_check", sql`${table.kind} IN ('open', 'won', 'lost')`),
    check("stages_position_check", sql`${table.position} >= 0`),
    check(
      "stages_default_check",
      sql`NOT ${table.isDefault} OR (${table.archivedAt} IS NULL AND ${table.kind} = 'open')`,
    ),
    unique("stages_company_name_key").on(table.companyId, table.name),
    unique("stages_company_seed_key").on(table.companyId, table.seedKey),
    unique("stages_company_id_key").on(table.companyId, table.id),
    uniqueIndex("stages_one_default_idx")
      .on(table.companyId)
      .where(sql`${table.isDefault}`),
    ...companyPolicies("stages", table.companyId),
  ],
).enableRLS();

export const outcomes = pgTable(
  "outcomes",
  {
    ...companyColumns(),
    name: text("name").notNull(),
    countsAsFailed: boolean("counts_as_failed").notNull(),
    position: integer("position").notNull(),
    seedKey: text("seed_key"),
    archivedAt: at("archived_at"),
  },
  (table) => [
    check("outcomes_position_check", sql`${table.position} >= 0`),
    unique("outcomes_company_name_key").on(table.companyId, table.name),
    unique("outcomes_company_seed_key").on(table.companyId, table.seedKey),
    unique("outcomes_company_id_key").on(table.companyId, table.id),
    ...companyPolicies("outcomes", table.companyId),
  ],
).enableRLS();

export const lostReasons = pgTable(
  "lost_reasons",
  {
    ...companyColumns(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    seedKey: text("seed_key"),
    archivedAt: at("archived_at"),
  },
  (table) => [
    check("lost_reasons_position_check", sql`${table.position} >= 0`),
    unique("lost_reasons_company_name_key").on(table.companyId, table.name),
    unique("lost_reasons_company_seed_key").on(table.companyId, table.seedKey),
    unique("lost_reasons_company_id_key").on(table.companyId, table.id),
    ...companyPolicies("lost_reasons", table.companyId),
  ],
).enableRLS();
