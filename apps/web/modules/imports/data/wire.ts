import {
  dryRunWireSchema,
  type ImportReport,
  importDraftWireSchema,
  importReportWireSchema,
  importRowsPageWireSchema,
  type UploadResultReal,
  uploadResultWireSchema,
} from "@anar/domain/imports";

export const importReportSchema = importReportWireSchema.transform(
  (report): ImportReport => ({
    ...report,
    createdAt: new Date(report.createdAt),
    startedAt: report.startedAt ? new Date(report.startedAt) : null,
    finishedAt: report.finishedAt ? new Date(report.finishedAt) : null,
  }),
);
export const importRowsPageSchema = importRowsPageWireSchema;

export const importDraftSchema = importDraftWireSchema;
export const dryRunResultSchema = dryRunWireSchema;

export const uploadResultSchema = uploadResultWireSchema.transform(
  (result): UploadResultReal => ({
    ...result,
    dateRange: result.dateRange && {
      from: new Date(result.dateRange.from),
      to: new Date(result.dateRange.to),
    },
  }),
);
