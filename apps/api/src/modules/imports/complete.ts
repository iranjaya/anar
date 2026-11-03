import type { TenantTx } from "@anar/db/tenant";
import type { ImportSummary } from "@anar/domain/imports";
import type { NotificationInput } from "@anar/domain/notifications";
import repository from "./repository.js";

export type CompleteDeps = {
  notify(tx: TenantTx, input: NotificationInput): Promise<{ id: string }>;
  readScopedCompanySlug(tx: TenantTx): Promise<string>;
  listSuperAdminUserIds(tx: TenantTx): Promise<string[]>;
  canReceiveCompanyNotification(tx: TenantTx, userId: string): Promise<boolean>;
};

const complete = {
  // Totals come from the result rows, so a finished batch always matches its ledger.
  async finish(
    deps: CompleteDeps,
    tx: TenantTx,
    current: { batchId: string; runId: string },
  ): Promise<ImportSummary | null> {
    const batch = await repository.lockBatch(tx, current.batchId);
    if (!batch?.frozen || batch.activeRunId !== current.runId) return null;
    if (batch.status === "done") return batch.summary as ImportSummary;
    const summary: ImportSummary = {
      imported: 0,
      needPhoneReview: 0,
      duplicateDb: 0,
      duplicateFile: 0,
      invalid: 0,
      error: 0,
      newOptions: batch.frozen.newOptionsAdded,
    };
    let total = 0;
    for (const { result, reason, count } of await repository.countResults(
      tx,
      batch.id,
    )) {
      total += count;
      if (result === "imported") summary.imported += count;
      if (reason === "invalid_phone") summary.needPhoneReview += count;
      if (result === "duplicate_db") summary.duplicateDb += count;
      if (result === "duplicate_file") summary.duplicateFile += count;
      if (result === "invalid") summary.invalid += count;
      if (result === "error") summary.error += count;
    }
    if (total !== batch.rowCount || batch.lastRowNo !== batch.rowCount)
      throw new Error("Import results do not cover every row");
    await repository.updateBatch(tx, batch.id, {
      status: "done",
      summary,
      error: null,
      finishedAt: new Date(),
    });
    await repository.updateRun(tx, current.runId, {
      state: "done",
      stopCode: null,
    });
    await complete._notify(deps, tx, batch, summary);
    return summary;
  },
  // Someone who lost access is skipped; the import still finishes.
  async _notify(
    deps: CompleteDeps,
    tx: TenantTx,
    batch: { id: string; companyId: string; uploadedBy: string },
    summary: ImportSummary,
  ): Promise<void> {
    const slug = await deps.readScopedCompanySlug(tx);
    const users = new Set([
      batch.uploadedBy,
      ...(await deps.listSuperAdminUserIds(tx)),
    ]);
    for (const userId of users) {
      if (!(await deps.canReceiveCompanyNotification(tx, userId))) continue;
      await deps.notify(tx, {
        companyId: batch.companyId,
        userId,
        title: "Import finished",
        body: `${summary.imported} new leads, ${summary.duplicateDb} already in the list`,
        url: `/${slug}/imports/${batch.id}`,
        dedupeKey: `import:${batch.companyId}:${batch.id}`,
        data: {
          type: "import_complete",
          batchId: batch.id,
          imported: summary.imported,
          duplicateDb: summary.duplicateDb,
        },
      });
    }
  },
};
export default complete;
