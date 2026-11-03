import type {
  Encoding,
  HeaderColumn,
  ImportIssue,
  Mapping,
  NewField,
  NormalizedLead,
  Option,
} from "@anar/domain/imports";
import type { Field, FieldOptionAddition } from "@anar/domain/settings";

export type ReadControl = { signal: AbortSignal };
export type EncodingResult = {
  encoding: Encoding;
  bomLength: 0 | 2 | 3;
  warning: "encoding_fallback" | null;
};
export type { NormalizedLead };
export type NormalizedRow = {
  lead: NormalizedLead;
  issues: ImportIssue[];
  newOptions: { fieldKey: string; option: Option }[];
  invalid: boolean;
};
// Saved with a successful check; commit must see the same file, schema and choices.
export type CommitSnapshot = {
  fileSha256: string;
  schemaFingerprint: string;
  commitHash: string;
};
// Saved by commit after any settings change; every chunk normalizes with these values.
export type FrozenImport = CommitSnapshot & {
  mappingRevision: number;
  mapping: Mapping;
  newFields: NewField[];
  approvedOptions: FieldOptionAddition[];
  fields: Field[];
  defaultCountry: string;
  timezone: string;
  defaultStageId: string;
  newOptionsAdded: number;
};
// One data row as the file gave it, already normalized, in file order.
export type ChunkRow = {
  rowNo: number;
  raw: Record<string, string>;
  normalized: NormalizedRow;
};
export type NormaliseRowInput = {
  row: string[];
  columns: HeaderColumn[];
  mapping: Mapping;
  fields: Field[];
  defaultCountry: string;
  timezone: string;
  importedAt: Date;
};
