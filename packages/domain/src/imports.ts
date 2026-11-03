import { z } from "zod";
import { wireDateSchema } from "./http.js";
import type { Lead } from "./leads.js";
import type { ScoreResult } from "./scoring.js";
import type { Field } from "./settings.js";

export type Encoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
export type Delimiter = "," | "\t" | ";" | "|";
export type Option = { value: string; label: string };
export type HeaderColumn = {
  index: number;
  original: string;
  header: string;
  normalized: string;
};
export type CsvProfile = {
  encoding: Encoding;
  delimiter: Delimiter;
  columns: HeaderColumn[];
  sample: string[][];
  rowCount: number;
  dateRange: { from: Date; to: Date } | null;
  warning: "encoding_fallback" | null;
  columnKinds: { header: string; type: Field["type"]; options: Option[] }[];
};
export type ImportIssue = {
  code:
    | "invalid_phone"
    | "bad_date"
    | "invalid_number"
    | "invalid_custom_date"
    | "new_option"
    | "unknown_platform"
    | "column_count";
  header: string | null;
  message: string;
};

export type MappingTarget =
  | `system:${"full_name" | "phone" | "email" | "lead_date" | "campaign_name" | "form_name" | "source"}`
  | `field:${string}`
  | "skip";
export type Mapping = { header: string; target: MappingTarget }[];
export type NewField = {
  header: string;
  key: string;
  label: string;
  type: Field["type"];
  options?: Option[];
};
export type MappingTemplate = {
  id: string;
  companyId: string;
  name: string;
  headerFingerprint: string;
  headers: string[];
  mapping: Mapping;
  formName: string | null;
  campaignName: string | null;
  createdBy: string;
  lastUsedAt: Date | null;
};
export type ImportSummary = {
  imported: number;
  needPhoneReview: number;
  duplicateDb: number;
  duplicateFile: number;
  invalid: number;
  error: number;
  newOptions: number;
};
export type ImportBatch = {
  id: string;
  companyId: string;
  uploadedBy: string;
  sourceKind: "csv";
  fileName: string;
  fileSize: number;
  encoding: Encoding;
  delimiter: Delimiter;
  rowCount: number;
  status: "uploaded" | "mapped" | "running" | "done" | "failed";
  mappingTemplateId: string | null;
  mapping: Mapping | null;
  lastRowNo: number;
  summary: ImportSummary | null;
  createdAt: Date;
};
export type ImportRow = {
  id: string;
  batchId: string;
  rowNo: number;
  raw: Record<string, string>;
  phoneE164: string | null;
  result: "imported" | "duplicate_db" | "duplicate_file" | "invalid" | "error";
  leadId: string | null;
  reason: "same_submission" | "resubmitted" | "invalid_phone" | null;
};
export type NormalizedLead = {
  fullName: string | null;
  phoneRaw: string | null;
  phoneE164: string | null;
  phoneValid: boolean;
  email: string | null;
  source: Lead["source"];
  leadDate: Date;
  campaignName: string | null;
  formName: string | null;
  externalId: null;
  custom: Record<string, string | number | null>;
};
export type ImportInsert = {
  rowNo: number;
  lead: NormalizedLead;
  issues: ImportIssue[];
  score: ScoreResult;
};
export type ImportWriteResult = {
  rows: {
    rowNo: number;
    leadId: string;
    result: "imported" | "duplicate_db";
    reason: "same_submission" | "resubmitted" | "invalid_phone" | null;
  }[];
};
export type UploadResult = Pick<
  ImportBatch,
  "encoding" | "delimiter" | "rowCount"
> & {
  batchId: string;
  headers: string[];
  sample: string[][];
  dateRange: { from: Date; to: Date };
  matchedTemplate?: { id: string; name: string };
  suggestedMapping: Mapping;
  proposedFields: NewField[];
  newColumns: string[];
  missingColumns: string[];
};
export type DryRun = {
  toAdd: number;
  needPhoneReview: number;
  sameSubmission: number;
  resubmitted: ImportRow[];
  duplicateFile: ImportRow[];
  phoneReview: ImportRow[];
};
export type MappingSuggestion = Pick<
  UploadResult,
  | "matchedTemplate"
  | "suggestedMapping"
  | "proposedFields"
  | "newColumns"
  | "missingColumns"
>;
export type UploadResultReal = Omit<
  UploadResult,
  "encoding" | "delimiter" | "dateRange"
> & {
  encoding: Encoding;
  delimiter: Delimiter;
  fileName: string;
  dateRange: { from: Date; to: Date } | null;
  warnings: "encoding_fallback"[];
};
export type ImportDraftInput = {
  batchId: string;
  mapping: Mapping;
  newFields: NewField[];
  saveTemplate?: { name: string };
  expectedRevision: number;
};
export type PreviewRow = ImportRow & {
  display: { fullName: string | null; phoneRaw: string | null };
  issues: ImportIssue[];
};
export type DryRunResult = Omit<
  DryRun,
  "resubmitted" | "duplicateFile" | "phoneReview"
> & {
  resubmitted: PreviewRow[];
  duplicateFile: PreviewRow[];
  phoneReview: PreviewRow[];
  invalidRows: PreviewRow[];
  newOptions: { fieldKey: string; option: Option }[];
  counts: {
    rowCount: number;
    resubmitted: number;
    duplicateFile: number;
    invalid: number;
  };
  previewRevision: number;
};
export type ImportDraft = Omit<ImportDraftInput, "expectedRevision"> & {
  revision: number;
  preview: DryRunResult | null;
};

const systemTargets = [
  "system:full_name",
  "system:phone",
  "system:email",
  "system:lead_date",
  "system:campaign_name",
  "system:form_name",
  "system:source",
  "skip",
] as const;
export const mappingSchema = z.array(
  z.strictObject({
    header: z.string().min(1),
    target: z.union([
      z.enum(systemTargets),
      z.templateLiteral(["field:", z.string().regex(/^[a-z][a-z0-9_]*$/)]),
    ]),
  }),
);
const optionWireSchema = z.strictObject({
  value: z.string(),
  label: z.string(),
});
export const newFieldSchema = z.strictObject({
  header: z.string().min(1),
  key: z.string(),
  label: z.string(),
  type: z.enum(["text", "number", "date", "dropdown"]),
  options: z.array(optionWireSchema).optional(),
});
export const uploadResultWireSchema = z.strictObject({
  batchId: z.uuid(),
  encoding: z.enum(["utf-8", "utf-16le", "utf-16be", "windows-1252"]),
  delimiter: z.enum([",", "\t", ";", "|"]),
  rowCount: z.number().int().nonnegative(),
  fileName: z.string(),
  headers: z.array(z.string()),
  sample: z.array(z.array(z.string())),
  dateRange: z
    .strictObject({ from: wireDateSchema, to: wireDateSchema })
    .nullable(),
  warnings: z.array(z.literal("encoding_fallback")),
  matchedTemplate: z
    .strictObject({ id: z.uuid(), name: z.string() })
    .optional(),
  suggestedMapping: mappingSchema,
  proposedFields: z.array(newFieldSchema),
  newColumns: z.array(z.string()),
  missingColumns: z.array(z.string()),
});
export const batchIdQuerySchema = z.strictObject({ batchId: z.uuid() });
const saveTemplateSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});
export const importDraftInputSchema = z.strictObject({
  batchId: z.uuid(),
  mapping: mappingSchema.min(1),
  newFields: z.array(newFieldSchema),
  saveTemplate: saveTemplateSchema.optional(),
  expectedRevision: z.number().int().nonnegative(),
});
export const commitImportInputSchema = importDraftInputSchema.extend({
  previewRevision: z.number().int().positive(),
});
export type CommitImportInput = z.infer<typeof commitImportInputSchema>;
export const commitImportResultWireSchema = z.strictObject({
  jobId: z.uuid(),
});
export type CommitImportResult = z.infer<typeof commitImportResultWireSchema>;
const count = z.number().int().nonnegative();
const issueSchema = z.strictObject({
  code: z.enum([
    "invalid_phone",
    "bad_date",
    "invalid_number",
    "invalid_custom_date",
    "new_option",
    "unknown_platform",
    "column_count",
  ]),
  header: z.string().nullable(),
  message: z.string(),
});
const previewRowSchema = z.strictObject({
  id: z.string(),
  batchId: z.uuid(),
  rowNo: z.number().int().positive(),
  raw: z.record(z.string(), z.string()),
  phoneE164: z.string().nullable(),
  result: z.enum([
    "imported",
    "duplicate_db",
    "duplicate_file",
    "invalid",
    "error",
  ]),
  leadId: z.uuid().nullable(),
  reason: z
    .enum(["same_submission", "resubmitted", "invalid_phone"])
    .nullable(),
  display: z.strictObject({
    fullName: z.string().nullable(),
    phoneRaw: z.string().nullable(),
  }),
  issues: z.array(issueSchema),
});
export const dryRunWireSchema = z.strictObject({
  toAdd: count,
  needPhoneReview: count,
  sameSubmission: count,
  resubmitted: z.array(previewRowSchema),
  duplicateFile: z.array(previewRowSchema),
  phoneReview: z.array(previewRowSchema),
  invalidRows: z.array(previewRowSchema),
  newOptions: z.array(
    z.strictObject({ fieldKey: z.string(), option: optionWireSchema }),
  ),
  counts: z.strictObject({
    rowCount: count,
    resubmitted: count,
    duplicateFile: count,
    invalid: count,
  }),
  previewRevision: z.number().int().positive(),
});
export const importDraftWireSchema = z.strictObject({
  batchId: z.uuid(),
  mapping: mappingSchema,
  newFields: z.array(newFieldSchema),
  saveTemplate: saveTemplateSchema.optional(),
  revision: z.number().int().positive(),
  preview: dryRunWireSchema.nullable(),
});

export const importStopCodes = [
  "file_missing",
  "file_changed",
  "schema_changed",
  "access_removed",
  "processing_failed",
] as const;
export type ImportStopCode = (typeof importStopCodes)[number];
export type ImportReport = ImportBatch & {
  startedAt: Date | null;
  finishedAt: Date | null;
  error: { code: ImportStopCode; message: string } | null;
  runState: "queued" | "running" | "retrying" | "stopped" | "done" | null;
  canResume: boolean;
};
export type ImportResultRow = Omit<ImportRow, "raw"> & {
  raw: Record<string, string> | null;
  issues: ImportIssue[];
};
export const importRowsQuerySchema = z.strictObject({
  batchId: z.uuid(),
  afterRowNo: z.coerce.number().int().nonnegative().optional(),
  filter: z.enum(["all", "exceptions", "phone_review"]).optional(),
});
export type ImportRowsQuery = z.infer<typeof importRowsQuerySchema>;
export type ImportRowsPage = {
  items: ImportResultRow[];
  nextRowNo: number | null;
  total: number;
};
export const importReportWireSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  uploadedBy: z.uuid(),
  sourceKind: z.literal("csv"),
  fileName: z.string(),
  fileSize: count,
  encoding: z.enum(["utf-8", "utf-16le", "utf-16be", "windows-1252"]),
  delimiter: z.enum([",", "\t", ";", "|"]),
  rowCount: count,
  status: z.enum(["uploaded", "mapped", "running", "done", "failed"]),
  mappingTemplateId: z.uuid().nullable(),
  mapping: mappingSchema.nullable(),
  lastRowNo: count,
  summary: z
    .strictObject({
      imported: count,
      needPhoneReview: count,
      duplicateDb: count,
      duplicateFile: count,
      invalid: count,
      error: count,
      newOptions: count,
    })
    .nullable(),
  createdAt: wireDateSchema,
  startedAt: wireDateSchema.nullable(),
  finishedAt: wireDateSchema.nullable(),
  error: z
    .strictObject({ code: z.enum(importStopCodes), message: z.string() })
    .nullable(),
  runState: z
    .enum(["queued", "running", "retrying", "stopped", "done"])
    .nullable(),
  canResume: z.boolean(),
});
export const importRowsPageWireSchema = z.strictObject({
  items: z.array(
    previewRowSchema.omit({ display: true }).extend({
      id: z.uuid(),
      raw: z.record(z.string(), z.string()).nullable(),
    }),
  ),
  nextRowNo: z.number().int().positive().nullable(),
  total: count,
});
