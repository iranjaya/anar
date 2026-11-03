import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
import { at, companyColumns, companyPolicies } from "./companyRows.js";

export const companyJobPeriods = pgTable(
  "company_job_periods",
  {
    ...companyColumns(),
    jobName: text("job_name").notNull(),
    periodKey: text("period_key").notNull(),
    scheduledAt: at("scheduled_at").notNull(),
    timezone: text("timezone").notNull(),
    status: text("status").notNull().$type<"pending" | "running" | "done">(),
    cursor: text("cursor"),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
  },
  (table) => [
    check(
      "company_job_periods_status_check",
      sql`${table.status} IN ('pending', 'running', 'done')`,
    ),
    unique("company_job_periods_unique_key").on(
      table.companyId,
      table.jobName,
      table.periodKey,
    ),
    index("company_job_periods_status_idx").on(
      table.companyId,
      table.jobName,
      table.status,
    ),
    ...companyPolicies("company_job_periods", table.companyId),
  ],
);
