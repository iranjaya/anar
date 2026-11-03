import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companyColumns, companyPolicies } from "./companyRows.js";
import { users } from "./platform.js";

export const scoringConfigs = pgTable(
  "scoring_configs",
  {
    ...companyColumns(),
    version: integer("version").notNull(),
    basePoints: integer("base_points").notNull(),
    hotMin: integer("hot_min").notNull(),
    warmMin: integer("warm_min").notNull(),
    rules: jsonb("rules").notNull().$type<unknown[]>(),
    active: boolean("active").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    check(
      "scoring_configs_numbers_check",
      sql`${table.version} >= 1 AND ${table.basePoints} >= 0 AND ${table.warmMin} >= 0 AND ${table.warmMin} < ${table.hotMin}`,
    ),
    check(
      "scoring_configs_rules_check",
      sql`jsonb_typeof(${table.rules}) = 'array'`,
    ),
    unique("scoring_configs_company_version_key").on(
      table.companyId,
      table.version,
    ),
    uniqueIndex("scoring_configs_active_idx")
      .on(table.companyId)
      .where(sql`${table.active}`),
    ...companyPolicies("scoring_configs", table.companyId),
  ],
);
