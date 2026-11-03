import { AppError } from "@anar/domain/errors";
import {
  batchIdQuerySchema,
  type CommitImportResult,
  type ImportStopCode,
} from "@anar/domain/imports";
import { v7 } from "uuid";
import { readImportJobState } from "../../lib/jobs/index.js";
import audit from "../tenant/audit.js";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import commitSnapshot from "./commitSnapshot.js";
import report from "./report.js";
import repository from "./repository.js";
import type { ImportDeps } from "./service.js";

const live = new Set(["queued", "active", "retrying"]);
const blocked: Partial<Record<ImportStopCode, string>> = {
  file_missing: "The uploaded file is gone, so this import cannot resume.",
  file_changed: "The uploaded file changed, so this import cannot resume.",
  schema_changed:
    "Company fields or the default stage changed, so this import cannot resume. Start a new import.",
};

const resume = {
  // A live job is returned as it is; only a stopped run gets a new run with today's authority.
  async resumeImport(
    deps: ImportDeps,
    actor: Ctx,
    raw: { batchId: string },
    request: { ip: string | null },
  ): Promise<CommitImportResult> {
    const parsed = batchIdQuerySchema.safeParse(raw);
    if (!parsed.success) throw new AppError("validation", "Choose an import");
    const at = deps.now();
    // A refusal is returned, not thrown, so the stopped state recorded first is kept.
    const outcome = await deps.context.withContext<
      CommitImportResult | { blocked: string }
    >(actor, async (tx, current) => {
      permissions.require(current, "imports.commit");
      const batch = await repository.lockBatch(tx, parsed.data.batchId);
      if (!batch) throw new AppError("not_found", "Import not found");
      if (batch.status === "done")
        throw new AppError("conflict", "This import is already done");
      const run = batch.activeRunId
        ? await repository.lockRun(tx, batch.activeRunId)
        : null;
      if (!batch.frozen || !run)
        throw new AppError("conflict", "This import has not started");
      if (run.jobId && run.state !== "stopped" && run.state !== "done") {
        const job = await readImportJobState(tx, run.jobId);
        if (live.has(job.state)) return { jobId: run.jobId };
      }
      const state = await report.runState(deps, tx, batch, run);
      if (state.runState !== "stopped" && run.jobId)
        return { jobId: run.jobId };
      const stopCode = state.stopCode ?? "processing_failed";
      if (run.state !== "stopped") {
        await repository.updateRun(tx, run.id, { state: "stopped", stopCode });
        await repository.updateBatch(tx, batch.id, {
          status: "failed",
          error: stopCode,
        });
      }
      const why = blocked[stopCode];
      if (why) return { blocked: why };
      const schema = await deps.loadSchema(tx);
      if (
        commitSnapshot.schemaFingerprint(schema.fields, current.company) !==
          batch.frozen.schemaFingerprint ||
        !schema.stages.some(
          (stage) =>
            stage.id === batch.frozen?.defaultStageId && stage.isDefault,
        )
      )
        return { blocked: blocked.schema_changed as string };
      const runId = v7();
      await repository.insertRun(tx, {
        id: runId,
        companyId: current.companyId,
        batchId: batch.id,
        runNo: run.runNo + 1,
        actorUserId: current.user.id,
        role: current.role === "agency_staff" ? "agency_staff" : "super_admin",
        authorizedAt: at,
        mappingRevision: batch.frozen.mappingRevision,
        state: "queued",
      });
      await repository.updateBatch(tx, batch.id, {
        status: "mapped",
        error: null,
        activeRunId: runId,
      });
      const jobId = await deps.enqueue(
        tx,
        "import.commit",
        {
          agencyId: current.agencyId,
          companyId: current.companyId,
          actorUserId: current.user.id,
          batchId: batch.id,
          runId,
        },
        `import:${current.companyId}:${batch.id}:${runId}`,
      );
      await repository.updateRun(tx, runId, { jobId });
      await audit.audit(
        tx,
        {
          user: current.user,
          role: current.role,
          agencyId: current.agencyId,
          companyId: current.companyId,
          ip: request.ip,
        },
        "imports.resumed",
        { type: "import_batch", id: batch.id },
        { batchId: batch.id, runId },
      );
      return { jobId };
    });
    if ("blocked" in outcome) throw new AppError("conflict", outcome.blocked);
    return outcome;
  },
};
export default resume;
