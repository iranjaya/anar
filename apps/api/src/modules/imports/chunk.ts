import type { TenantTx } from "@anar/db/tenant";
import type {
  ImportInsert,
  ImportRow,
  ImportWriteResult,
} from "@anar/domain/imports";
import type {
  ScoreInput,
  ScoreResult,
  ScoringConfig,
} from "@anar/domain/scoring";
import type { CompanySchema } from "@anar/domain/settings";
import { v7 } from "uuid";
import commitSnapshot from "./commitSnapshot.js";
import repository from "./repository.js";
import type { ChunkRow, FrozenImport } from "./types.js";

export type ChunkActor = {
  actorUserId: string;
  actorMemberId: string | null;
  batchId: string;
  runId: string;
  company: { defaultCountry: string; timezone: string };
};
export type ImportJobDeps = {
  loadSchema(tx: TenantTx): Promise<CompanySchema>;
  loadActiveConfig(tx: TenantTx): Promise<ScoringConfig>;
  scoreLead(input: ScoreInput, config: ScoringConfig): ScoreResult;
  addImportedLeads(
    tx: TenantTx,
    current: ChunkActor,
    input: { batchId: string; stageId: string; rows: ImportInsert[] },
  ): Promise<ImportWriteResult>;
};
export type ChunkStop = "stale" | "schema_changed";
type Ledger = Pick<ImportRow, "result" | "leadId" | "reason">;

const chunk = {
  // Leads, events, result rows and progress land together, or the chunk is redone.
  async commitChunk(
    deps: ImportJobDeps,
    tx: TenantTx,
    current: ChunkActor,
    input: { rows: ChunkRow[]; throughRowNo: number },
  ): Promise<ChunkStop | null> {
    const batch = await repository.lockBatch(tx, current.batchId);
    if (!batch?.frozen || batch.activeRunId !== current.runId) return "stale";
    const { frozen } = batch;
    if (input.throughRowNo <= batch.lastRowNo) return null;
    const { rows, throughRowNo } = input;
    if (
      rows[0]?.rowNo !== batch.lastRowNo + 1 ||
      rows.at(-1)?.rowNo !== throughRowNo
    )
      throw new Error("Import chunk does not follow the saved progress");
    if (!(await chunk._sameSettings(deps, tx, current, frozen)))
      return "schema_changed";
    const ledger = await chunk._classify(deps, tx, current, {
      batchId: batch.id,
      stageId: frozen.defaultStageId,
      rows,
    });
    await repository.insertRows(
      tx,
      rows.map(({ rowNo, raw, normalized }) => ({
        id: v7(),
        companyId: batch.companyId,
        batchId: batch.id,
        rowNo,
        raw,
        phoneE164: normalized.lead.phoneE164,
        issues: normalized.issues,
        ...(ledger.get(rowNo) as Ledger),
      })),
    );
    await repository.updateBatch(tx, batch.id, { lastRowNo: throughRowNo });
    return null;
  },
  async _sameSettings(
    deps: ImportJobDeps,
    tx: TenantTx,
    current: ChunkActor,
    frozen: FrozenImport,
  ): Promise<boolean> {
    const schema = await deps.loadSchema(tx);
    return (
      commitSnapshot.schemaFingerprint(schema.fields, current.company) ===
        frozen.schemaFingerprint &&
      schema.stages.some(
        (stage) => stage.id === frozen.defaultStageId && stage.isDefault,
      )
    );
  },
  // File order decides which row owns a phone, also across chunks and restarts.
  async _classify(
    deps: ImportJobDeps,
    tx: TenantTx,
    current: ChunkActor,
    input: { batchId: string; stageId: string; rows: ChunkRow[] },
  ): Promise<Map<number, Ledger>> {
    const { batchId, stageId, rows } = input;
    const ledger = new Map<number, Ledger>();
    const claimed = await repository.claimedPhones(
      tx,
      batchId,
      rows.flatMap(({ normalized }) =>
        normalized.invalid || !normalized.lead.phoneE164
          ? []
          : [normalized.lead.phoneE164],
      ),
    );
    const config = await deps.loadActiveConfig(tx);
    const inserts: ImportInsert[] = [];
    for (const { rowNo, normalized } of rows) {
      const { lead, issues, invalid } = normalized;
      if (invalid) {
        ledger.set(rowNo, { result: "invalid", leadId: null, reason: null });
        continue;
      }
      if (lead.phoneE164 && claimed.has(lead.phoneE164)) {
        ledger.set(rowNo, {
          result: "duplicate_file",
          leadId: null,
          reason: null,
        });
        continue;
      }
      if (lead.phoneE164) claimed.add(lead.phoneE164);
      inserts.push({
        rowNo,
        lead,
        issues,
        score: deps.scoreLead({ custom: lead.custom }, config),
      });
    }
    const written = await deps.addImportedLeads(tx, current, {
      batchId,
      stageId,
      rows: inserts,
    });
    for (const { rowNo, ...row } of written.rows) ledger.set(rowNo, row);
    return ledger;
  },
};
export default chunk;
