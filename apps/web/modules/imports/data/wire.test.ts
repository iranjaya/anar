import {
  commitImportInputSchema,
  commitImportResultWireSchema,
} from "@anar/domain/imports";
import { describe, expect, it } from "vitest";
import {
  importReportSchema,
  importRowsPageSchema,
  uploadResultSchema,
} from "./wire";

const wire = {
  batchId: "01900000-0000-7000-8000-000000000001",
  encoding: "utf-16le",
  delimiter: "\t",
  rowCount: 1884,
  fileName: "Spring_Leads_2026-09-12_2026-10-24.csv",
  headers: ["full_name", "phone"],
  sample: [["Test Lead", "p:+9779841000001"]],
  dateRange: {
    from: "2026-09-12T04:26:12.000Z",
    to: "2026-10-24T02:30:00.000Z",
  },
  warnings: [],
  suggestedMapping: [
    { header: "full_name", target: "system:full_name" },
    { header: "phone", target: "system:phone" },
  ],
  proposedFields: [],
  newColumns: [],
  missingColumns: [],
};

describe("upload result decoding", () => {
  it("turns wire dates into dates and keeps the real counts", () => {
    const result = uploadResultSchema.parse(wire);
    expect(result.dateRange).toEqual({
      from: new Date("2026-09-12T04:26:12.000Z"),
      to: new Date("2026-10-24T02:30:00.000Z"),
    });
    expect(result.rowCount).toBe(1884);
  });

  it("keeps a file with no lead dates and its encoding warning", () => {
    const result = uploadResultSchema.parse({
      ...wire,
      encoding: "windows-1252",
      dateRange: null,
      warnings: ["encoding_fallback"],
    });
    expect(result.dateRange).toBeNull();
    expect(result.warnings).toEqual(["encoding_fallback"]);
  });

  it.each([
    ["the old demo shape without warnings", { warnings: undefined }],
    ["a server file path", { filePath: "imports/x.csv" }],
    ["an unknown encoding", { encoding: "utf-32" }],
  ])("refuses %s", (_, change) => {
    expect(uploadResultSchema.safeParse({ ...wire, ...change }).success).toBe(
      false,
    );
  });
});

describe("import report decoding", () => {
  const report = {
    id: wire.batchId,
    companyId: "01900000-0000-7000-8000-000000000002",
    uploadedBy: "01900000-0000-7000-8000-000000000003",
    sourceKind: "csv",
    fileName: "leads.csv",
    fileSize: 120,
    encoding: "utf-8",
    delimiter: ",",
    rowCount: 3,
    status: "running",
    mappingTemplateId: null,
    mapping: wire.suggestedMapping,
    lastRowNo: 0,
    summary: null,
    createdAt: "2026-10-31T04:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    error: null,
    runState: "queued",
    canResume: false,
  };
  it("reads each run state and turns times into dates", () => {
    for (const runState of [
      "queued",
      "running",
      "retrying",
      "stopped",
      "done",
      null,
    ])
      expect(importReportSchema.parse({ ...report, runState }).runState).toBe(
        runState,
      );
    const stopped = importReportSchema.parse({
      ...report,
      status: "failed",
      startedAt: "2026-10-31T04:01:00.000Z",
      error: { code: "processing_failed", message: "Processing stopped." },
      runState: "stopped",
      canResume: true,
    });
    expect(stopped.createdAt).toEqual(new Date("2026-10-31T04:00:00.000Z"));
    expect(stopped.startedAt).toEqual(new Date("2026-10-31T04:01:00.000Z"));
    expect(stopped.finishedAt).toBeNull();
    expect(
      importReportSchema.safeParse({ ...report, runState: "paused" }).success,
    ).toBe(false);
    expect(
      importReportSchema.safeParse({
        ...report,
        error: { code: "disk_full", message: "x" },
      }).success,
    ).toBe(false);
  });

  it("reads a page with an expired source row and no next page", () => {
    const page = importRowsPageSchema.parse({
      items: [
        {
          id: "01900000-0000-7000-8000-000000000004",
          batchId: wire.batchId,
          rowNo: 7,
          raw: null,
          phoneE164: null,
          result: "invalid",
          leadId: null,
          reason: null,
          issues: [],
        },
      ],
      nextRowNo: null,
      total: 1,
    });
    expect(page.items[0].raw).toBeNull();
    expect(
      importRowsPageSchema.safeParse({ ...page, nextRowNo: 0 }).success,
    ).toBe(false);
  });
});

describe("commit request and answer", () => {
  const commit = {
    batchId: wire.batchId,
    mapping: wire.suggestedMapping,
    newFields: [],
    expectedRevision: 2,
    previewRevision: 2,
  };
  it("sends the checked revision and reads back only the job", () => {
    expect(commitImportInputSchema.parse(commit)).toEqual(commit);
    const jobId = "01900000-0000-7000-8000-000000000009";
    expect(commitImportResultWireSchema.parse({ jobId })).toEqual({ jobId });
  });

  it("refuses a commit with no checked revision and a strange answer", () => {
    for (const previewRevision of [0, 1.5, undefined])
      expect(
        commitImportInputSchema.safeParse({ ...commit, previewRevision })
          .success,
      ).toBe(false);
    for (const answer of [
      { jobId: "job-1" },
      { jobId: wire.batchId, batchId: wire.batchId },
      {},
    ])
      expect(commitImportResultWireSchema.safeParse(answer).success).toBe(
        false,
      );
  });
});
