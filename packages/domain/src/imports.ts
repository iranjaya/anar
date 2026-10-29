import type { Field } from "./settings.js";

export type MappingTarget =
  | `system:${"full_name" | "phone" | "email" | "lead_date" | "campaign_name" | "source"}`
  | `field:${string}`
  | "skip";
export type Mapping = { header: string; target: MappingTarget }[];
export type NewField = {
  header: string;
  key: string;
  label: string;
  type: Field["type"];
  options?: { value: string; label: string }[];
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
  encoding: "utf-16le";
  delimiter: "\t";
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
