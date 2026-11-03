import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type ImportBatch,
  type ImportIssue,
  type ImportReport,
  type ImportRowsPage,
  type ImportRowsQuery,
  type ImportStopCode,
  importRowsQuerySchema,
} from "@anar/domain/imports";
import { readImportJobState } from "../../lib/jobs/index.js";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import repository, { type RunRow, type StoredBatch } from "./repository.js";
import type { ImportDeps } from "./service.js";

const pageSize = 50;
// A job pg-boss no longer has may still be inside its 15-minute delivery; wait that plus five minutes.
const missingGraceMs = 20 * 60_000;
const messages: Record<ImportStopCode, string> = {
  file_missing: "The uploaded file is no longer there. Upload it again.",
  file_changed: "The uploaded file changed after the check. Upload it again.",
  schema_changed:
    "Company fields or the default stage changed. Start a new import and check it again.",
  access_removed:
    "The person who started this import lost access. Someone who can import can resume it.",
  processing_failed:
    "Processing stopped after repeated errors. You can resume from the last saved row.",
};
const resumable = new Set<ImportStopCode>([
  "access_removed",
  "processing_failed",
]);

const report = {
  async getImportBatch(
    deps: ImportDeps,
    actor: Ctx,
    batchId: string,
  ): Promise<ImportReport> {
    return deps.context.withContext(actor, async (tx, current) => {
      const batch = await report._readable(tx, current, batchId);
      const run = batch.activeRunId
        ? await repository.readRun(tx, batch.activeRunId)
        : null;
      const state = run
        ? await report.runState(deps, tx, batch, run)
        : { runState: null, stopCode: null };
      return {
        ...report._batch(batch),
        startedAt: batch.startedAt,
        finishedAt: batch.finishedAt,
        error: state.stopCode
          ? { code: state.stopCode, message: messages[state.stopCode] }
          : null,
        runState: state.runState,
        canResume:
          state.runState === "stopped" &&
          state.stopCode !== null &&
          resumable.has(state.stopCode) &&
          permissions.can(current, "imports.commit"),
      };
    });
  },
  async listImportRows(
    deps: ImportDeps,
    actor: Ctx,
    raw: ImportRowsQuery,
  ): Promise<ImportRowsPage> {
    const parsed = importRowsQuerySchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("validation", "Choose an import and a row filter");
    const { batchId, afterRowNo = 0, filter = "exceptions" } = parsed.data;
    return deps.context.withContext(actor, async (tx, current) => {
      await report._readable(tx, current, batchId);
      const rows = await repository.listRows(
        tx,
        batchId,
        filter,
        afterRowNo,
        pageSize + 1,
      );
      const items = rows.slice(0, pageSize).map((row) => ({
        id: row.id,
        batchId: row.batchId,
        rowNo: row.rowNo,
        raw: row.raw,
        phoneE164: row.phoneE164,
        result: row.result,
        leadId: row.leadId,
        reason: row.reason as ImportRowsPage["items"][number]["reason"],
        issues: row.issues as ImportIssue[],
      }));
      return {
        items,
        nextRowNo:
          rows.length > pageSize ? (items.at(-1)?.rowNo ?? null) : null,
        total: await repository.countRows(tx, batchId, filter),
      };
    });
  },
  // Read only: a dead or lost job shows as stopped here; resume records it under the batch lock.
  async runState(
    deps: Pick<ImportDeps, "now">,
    tx: TenantTx,
    batch: StoredBatch,
    run: RunRow,
  ): Promise<{
    runState: ImportReport["runState"];
    stopCode: ImportStopCode | null;
  }> {
    if (run.state === "done" || run.state === "stopped")
      return { runState: run.state, stopCode: run.stopCode };
    const job = run.jobId
      ? await readImportJobState(tx, run.jobId)
      : { state: "missing" as const };
    const lost =
      job.state === "failed" ||
      (job.state === "completed" && batch.status !== "done") ||
      (job.state === "missing" &&
        deps.now().getTime() - run.updatedAt.getTime() > missingGraceMs);
    return lost
      ? { runState: "stopped", stopCode: run.stopCode ?? "processing_failed" }
      : { runState: run.state, stopCode: null };
  },
  // Managers who assign leads may read results even when Super Admin import is off.
  async _readable(
    tx: TenantTx,
    current: Ctx,
    batchId: string,
  ): Promise<StoredBatch> {
    if (
      !permissions.can(current, "imports.upload") &&
      !(
        current.role === "super_admin" &&
        permissions.can(current, "leads.assign")
      )
    )
      throw new AppError("forbidden", "This action is not allowed");
    const batch = await repository.readBatch(tx, batchId);
    if (!batch) throw new AppError("not_found", "Import not found");
    return batch;
  },
  _batch(batch: StoredBatch): ImportBatch {
    return {
      id: batch.id,
      companyId: batch.companyId,
      uploadedBy: batch.uploadedBy,
      sourceKind: batch.sourceKind,
      fileName: batch.fileName,
      fileSize: batch.fileSize,
      encoding: batch.encoding,
      delimiter: batch.delimiter,
      rowCount: batch.rowCount,
      status: batch.status,
      mappingTemplateId: batch.mappingTemplateId,
      mapping: batch.mapping as ImportBatch["mapping"],
      lastRowNo: batch.lastRowNo,
      summary: batch.summary as ImportBatch["summary"],
      createdAt: batch.createdAt,
    };
  },
};
export default report;
