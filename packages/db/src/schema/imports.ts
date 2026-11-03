import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { at, companyColumns, companyPolicies } from "./companyRows.js";
import { leads } from "./leads.js";
import { mappingTemplates, type StoredMapping } from "./mappingTemplates.js";
import { users } from "./platform.js";

// JSON shapes are checked by the imports module; dates inside are ISO strings.
type Json = Record<string, unknown>;

export const importBatches = pgTable(
  "import_batches",
  {
    ...companyColumns(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sourceKind: text("source_kind").notNull().$type<"csv">(),
    fileName: text("file_name").notNull(),
    filePath: text("file_path").notNull(),
    fileSize: integer("file_size").notNull(),
    encoding: text("encoding")
      .notNull()
      .$type<"utf-8" | "utf-16le" | "utf-16be" | "windows-1252">(),
    delimiter: text("delimiter").notNull().$type<"," | "\t" | ";" | "|">(),
    rowCount: integer("row_count").notNull(),
    status: text("status")
      .notNull()
      .$type<"uploaded" | "mapped" | "running" | "done" | "failed">(),
    mappingTemplateId: uuid("mapping_template_id"),
    mapping: jsonb("mapping").$type<StoredMapping>(),
    lastRowNo: integer("last_row_no").notNull().default(0),
    summary: jsonb("summary").$type<Json>(),
    error: text("error"),
    profile: jsonb("profile").notNull().$type<Json>(),
    draft: jsonb("draft").$type<Json>(),
    previewRevision: integer("preview_revision").notNull().default(0),
    startedAt: at("started_at"),
    finishedAt: at("finished_at"),
    activeRunId: uuid("active_run_id"),
    frozen: jsonb("frozen").$type<Json>(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      columns: [table.companyId, table.activeRunId],
      foreignColumns: [importRuns.companyId, importRuns.id] as [
        AnyPgColumn,
        AnyPgColumn,
      ],
    }).onDelete("restrict"),
    check("import_batches_source_kind_check", sql`${table.sourceKind} = 'csv'`),
    check(
      "import_batches_encoding_check",
      sql`${table.encoding} IN ('utf-8', 'utf-16le', 'utf-16be', 'windows-1252')`,
    ),
    check(
      "import_batches_delimiter_check",
      sql`${table.delimiter} IN (',', E'\\t', E'\\x3B', '|')`,
    ),
    check(
      "import_batches_status_check",
      sql`${table.status} IN ('uploaded', 'mapped', 'running', 'done', 'failed')`,
    ),
    check(
      "import_batches_counts_check",
      sql`${table.fileSize} >= 0 AND ${table.rowCount} >= 0 AND ${table.lastRowNo} >= 0 AND ${table.previewRevision} >= 0`,
    ),
    unique("import_batches_company_id_key").on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.mappingTemplateId],
      foreignColumns: [mappingTemplates.companyId, mappingTemplates.id],
    }).onDelete("restrict"),
    index("import_batches_created_idx").on(
      table.companyId,
      table.createdAt,
      table.id,
    ),
    ...companyPolicies("import_batches", table.companyId),
  ],
).enableRLS();

export const importRuns = pgTable(
  "import_runs",
  {
    ...companyColumns(),
    batchId: uuid("batch_id").notNull(),
    runNo: integer("run_no").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role").notNull().$type<"agency_staff" | "super_admin">(),
    authorizedAt: at("authorized_at").notNull(),
    mappingRevision: integer("mapping_revision").notNull(),
    state: text("state")
      .notNull()
      .$type<"queued" | "running" | "retrying" | "stopped" | "done">(),
    failureCount: integer("failure_count").notNull().default(0),
    jobId: uuid("job_id"),
    stopCode: text("stop_code").$type<
      | "file_missing"
      | "file_changed"
      | "schema_changed"
      | "access_removed"
      | "processing_failed"
    >(),
  },
  (table) => [
    check("import_runs_run_no_check", sql`${table.runNo} > 0`),
    check(
      "import_runs_role_check",
      sql`${table.role} IN ('agency_staff', 'super_admin')`,
    ),
    check(
      "import_runs_state_check",
      sql`${table.state} IN ('queued', 'running', 'retrying', 'stopped', 'done')`,
    ),
    check(
      "import_runs_failure_count_check",
      sql`${table.failureCount} BETWEEN 0 AND 3`,
    ),
    check(
      "import_runs_stop_code_check",
      sql`${table.stopCode} IN ('file_missing', 'file_changed', 'schema_changed', 'access_removed', 'processing_failed')`,
    ),
    unique("import_runs_company_id_key").on(table.companyId, table.id),
    unique("import_runs_batch_run_key").on(
      table.companyId,
      table.batchId,
      table.runNo,
    ),
    foreignKey({
      columns: [table.companyId, table.batchId],
      foreignColumns: [importBatches.companyId, importBatches.id],
    }).onDelete("restrict"),
    ...companyPolicies("import_runs", table.companyId),
  ],
).enableRLS();

export const importRows = pgTable(
  "import_rows",
  {
    ...companyColumns(),
    batchId: uuid("batch_id").notNull(),
    rowNo: integer("row_no").notNull(),
    raw: jsonb("raw").$type<Record<string, string>>(),
    phoneE164: text("phone_e164"),
    result: text("result")
      .notNull()
      .$type<
        "imported" | "duplicate_db" | "duplicate_file" | "invalid" | "error"
      >(),
    leadId: uuid("lead_id"),
    reason: text("reason"),
    issues: jsonb("issues").notNull().$type<Json[]>(),
  },
  (table) => [
    check(
      "import_rows_result_check",
      sql`${table.result} IN ('imported', 'duplicate_db', 'duplicate_file', 'invalid', 'error')`,
    ),
    foreignKey({
      columns: [table.companyId, table.batchId],
      foreignColumns: [importBatches.companyId, importBatches.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.leadId],
      foreignColumns: [leads.companyId, leads.id],
    }).onDelete("restrict"),
    unique("import_rows_batch_row_key").on(table.batchId, table.rowNo),
    index("import_rows_lead_idx").on(table.leadId),
    index("import_rows_batch_phone_idx").on(table.batchId, table.phoneE164),
    ...companyPolicies("import_rows", table.companyId),
  ],
).enableRLS();
