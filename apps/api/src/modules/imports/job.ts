import { join } from "node:path";
import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import type { CsvProfile } from "@anar/domain/imports";
import type { ImportCommitJob } from "@anar/domain/jobs";
import type { ImportJobCtx } from "../tenant/index.js";
import chunk, { type ChunkStop, type ImportJobDeps } from "./chunk.js";
import complete, { type CompleteDeps } from "./complete.js";
import files from "./files.js";
import normalize from "./normalize.js";
import parse from "./parse.js";
import repository, { type RunRow } from "./repository.js";
import type { ChunkRow, FrozenImport, ReadControl } from "./types.js";

export type ImportRunnerDeps = ImportJobDeps &
  CompleteDeps & {
    uploadsRoot: string;
    withImportJob<T>(
      payload: ImportCommitJob,
      fn: (tx: TenantTx, current: ImportJobCtx) => Promise<T>,
    ): Promise<T>;
    // Opens the run's company without its actor's rights, only to record why the run stopped.
    withImportRecord<T>(
      payload: ImportCommitJob,
      fn: (tx: TenantTx) => Promise<T>,
    ): Promise<T>;
  };
type StopCode = NonNullable<RunRow["stopCode"]>;
type Start = {
  filePath: string;
  columns: CsvProfile["columns"];
  createdAt: Date;
  lastRowNo: number;
  frozen: FrozenImport;
};

const chunkSize = 500;
const attempts = 3;

const job = {
  async runImport(
    deps: ImportRunnerDeps,
    payload: ImportCommitJob,
    control: ReadControl,
  ): Promise<void> {
    try {
      const start = await job._start(deps, payload);
      if (!start) return;
      const stop = await job._process(deps, payload, start, control);
      if (stop === "stale") return;
      if (stop) return job._stop(deps, payload, stop);
      await deps.withImportJob(payload, (tx) =>
        complete.finish(deps, tx, payload),
      );
    } catch (error) {
      if (control.signal.aborted) throw error;
      if (error instanceof AppError && error.code === "forbidden")
        return job._stop(deps, payload, "access_removed");
      await job._fail(deps, payload);
      throw error;
    }
  },
  async _start(
    deps: ImportRunnerDeps,
    payload: ImportCommitJob,
  ): Promise<Start | null> {
    return deps.withImportJob(payload, async (tx) => {
      const batch = await repository.lockBatch(tx, payload.batchId);
      const run = await repository.lockRun(tx, payload.runId);
      if (
        !batch?.frozen ||
        !run ||
        batch.status === "done" ||
        run.state === "stopped" ||
        run.state === "done"
      )
        return null;
      await repository.updateBatch(tx, batch.id, {
        status: "running",
        error: null,
        startedAt: batch.startedAt ?? new Date(),
      });
      await repository.updateRun(tx, run.id, { state: "running" });
      return {
        filePath: batch.filePath,
        columns: batch.profile.columns,
        createdAt: batch.createdAt,
        lastRowNo: batch.lastRowNo,
        frozen: batch.frozen,
      };
    });
  },
  // Reads the file outside any lock; each chunk is its own short transaction.
  async _process(
    deps: ImportRunnerDeps,
    payload: ImportCommitJob,
    start: Start,
    control: ReadControl,
  ): Promise<ChunkStop | StopCode | null> {
    const path = join(deps.uploadsRoot, start.filePath);
    const sha = await files.sha256(path, control);
    if (sha === null) return "file_missing";
    if (sha !== start.frozen.fileSha256) return "file_changed";
    const { frozen } = start;
    let rowNo = 0;
    let pending: ChunkRow[] = [];
    const flush = async () => {
      const rows = pending;
      pending = [];
      return deps.withImportJob(payload, (tx, current) =>
        chunk.commitChunk(deps, tx, current, {
          rows,
          throughRowNo: rows[rows.length - 1].rowNo,
        }),
      );
    };
    for await (const row of parse.dataRows(path, control)) {
      rowNo++;
      if (rowNo <= start.lastRowNo) continue;
      pending.push({
        rowNo,
        raw: Object.fromEntries(
          start.columns.map((column) => [
            column.header,
            row[column.index] ?? "",
          ]),
        ),
        normalized: normalize.normaliseRow({
          row,
          columns: start.columns,
          mapping: frozen.mapping,
          fields: frozen.fields,
          defaultCountry: frozen.defaultCountry,
          timezone: frozen.timezone,
          importedAt: start.createdAt,
        }),
      });
      if (pending.length === chunkSize) {
        const stop = await flush();
        if (stop) return stop;
      }
    }
    return pending.length > 0 ? flush() : null;
  },
  async _stop(
    deps: ImportRunnerDeps,
    payload: ImportCommitJob,
    code: StopCode,
  ): Promise<void> {
    await job._record(deps, payload, () => ({
      state: "stopped",
      stopCode: code,
    }));
  },
  async _fail(deps: ImportRunnerDeps, payload: ImportCommitJob): Promise<void> {
    await job._record(deps, payload, (run) => {
      const failureCount = Math.min(run.failureCount + 1, attempts);
      return failureCount < attempts
        ? { state: "retrying", failureCount, stopCode: null }
        : { state: "stopped", failureCount, stopCode: "processing_failed" };
    });
  },
  // Only the batch's active run may mark it failed; a newer run owns it otherwise.
  async _record(
    deps: ImportRunnerDeps,
    payload: ImportCommitJob,
    next: (run: RunRow) => Partial<RunRow>,
  ): Promise<void> {
    await deps.withImportRecord(payload, async (tx) => {
      const batch = await repository.lockBatch(tx, payload.batchId);
      const run = await repository.lockRun(tx, payload.runId);
      if (!batch || !run || batch.activeRunId !== run.id) return;
      if (batch.status === "done") return;
      const set = next(run);
      await repository.updateRun(tx, run.id, set);
      await repository.updateBatch(tx, batch.id, {
        status: "failed",
        error: set.stopCode ?? "processing_failed",
      });
    });
  },
};
export default job;
