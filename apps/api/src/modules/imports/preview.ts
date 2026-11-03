import { createHash, type Hash } from "node:crypto";
import { join } from "node:path";
import { AppError } from "@anar/domain/errors";
import {
  type DryRunResult,
  type ImportDraftInput,
  importDraftInputSchema,
  type NewField,
  type PreviewRow,
} from "@anar/domain/imports";
import type { ImportMatch } from "@anar/domain/leads";
import type { Field } from "@anar/domain/settings";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import commitSnapshot from "./commitSnapshot.js";
import draft from "./draft.js";
import normalize from "./normalize.js";
import parse from "./parse.js";
import repository, { type StoredBatch } from "./repository.js";
import type { ImportDeps } from "./service.js";
import type { NormalizedRow, ReadControl } from "./types.js";

const lookupSize = 500;
const shown = 50;

type Start = {
  batch: StoredBatch;
  revision: number;
  schemaKey: string;
  fields: Field[];
  company: { defaultCountry: string; timezone: string };
};
type Pending = { rowNo: number; row: string[]; normalized: NormalizedRow };

const preview = {
  async dryRunImport(
    deps: ImportDeps,
    actor: Ctx,
    raw: ImportDraftInput,
    control: ReadControl,
  ): Promise<DryRunResult> {
    const parsed = importDraftInputSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("validation", "Check the column choices");
    const input = parsed.data;
    const start = await preview._start(deps, actor, input);
    const hash = createHash("sha256");
    const result = await preview._scan(
      deps,
      actor,
      input,
      start,
      control,
      hash,
    );
    const fileSha256 = hash.digest("hex");
    control.signal.throwIfAborted();
    return deps.context.withContext(actor, async (tx, current) => {
      permissions.require(current, "imports.upload");
      const batch = await repository.lockBatch(tx, start.batch.id);
      const fields = (await deps.loadSchema(tx)).fields;
      if (!batch) throw new AppError("not_found", "Import not found");
      if (
        batch.status !== "uploaded" ||
        batch.previewRevision !== start.revision ||
        batch.filePath !== start.batch.filePath ||
        batch.createdAt.getTime() !== start.batch.createdAt.getTime() ||
        commitSnapshot.schemaFingerprint(fields, current.company) !==
          start.schemaKey
      )
        throw new AppError(
          "conflict",
          "The columns or company fields changed while checking. Check again",
        );
      control.signal.throwIfAborted();
      const { batchId, expectedRevision, ...kept } = input;
      const snapshot = commitSnapshot.create({
        fileSha256,
        mapping: input.mapping,
        plan: commitSnapshot.plan(input.newFields, result.newOptions),
        company: current.company,
        schemaFingerprint: start.schemaKey,
      });
      await repository.saveDraft(
        tx,
        batch.id,
        { ...kept, preview: result, snapshot },
        start.revision,
      );
      return result;
    });
  },
  // Saves the exact draft being checked and notes what the check depends on.
  async _start(
    deps: ImportDeps,
    actor: Ctx,
    input: ImportDraftInput,
  ): Promise<Start> {
    return deps.context.withContext(actor, async (tx, current) => {
      permissions.require(current, "imports.upload");
      const batch = await repository.lockBatch(tx, input.batchId);
      if (!batch) throw new AppError("not_found", "Import not found");
      if (batch.status !== "uploaded")
        throw new AppError("conflict", "This import has already started");
      if (batch.previewRevision !== input.expectedRevision)
        throw new AppError(
          "conflict",
          "These columns were changed in another tab. Reload to see the latest",
        );
      const fields = (await deps.loadSchema(tx)).fields;
      draft.validate(input, batch, fields);
      const revision = batch.previewRevision + 1;
      const { batchId, expectedRevision, ...kept } = input;
      await repository.saveDraft(
        tx,
        batch.id,
        { ...kept, preview: null },
        revision,
      );
      return {
        batch,
        revision,
        schemaKey: commitSnapshot.schemaFingerprint(fields, current.company),
        fields: [...fields, ...input.newFields.map(preview._asField(current))],
        company: current.company,
      };
    });
  },
  async _scan(
    deps: ImportDeps,
    actor: Ctx,
    input: ImportDraftInput,
    start: Start,
    control: ReadControl,
    hash: Hash,
  ): Promise<DryRunResult> {
    const { batch } = start;
    const result: DryRunResult = {
      toAdd: 0,
      needPhoneReview: 0,
      sameSubmission: 0,
      resubmitted: [],
      duplicateFile: [],
      phoneReview: [],
      invalidRows: [],
      newOptions: [],
      counts: { rowCount: 0, resubmitted: 0, duplicateFile: 0, invalid: 0 },
      previewRevision: start.revision,
    };
    const options = new Set<string>();
    const seen = new Set<string>();
    let pending: Pending[] = [];
    const flush = async () => {
      const matches = await deps.context.withContext(actor, (tx, current) => {
        permissions.require(current, "imports.upload");
        return deps.findImportMatches(tx, {
          phones: pending.map((item) => item.normalized.lead.phoneE164 ?? ""),
        });
      });
      preview._classify(result, batch, pending, matches);
      pending = [];
      control.signal.throwIfAborted();
    };
    const path = join(deps.uploadsRoot, batch.filePath);
    for await (const row of parse.dataRows(path, control, hash)) {
      const rowNo = ++result.counts.rowCount;
      const normalized = normalize.normaliseRow({
        row,
        columns: batch.profile.columns,
        mapping: input.mapping,
        fields: start.fields,
        defaultCountry: start.company.defaultCountry,
        timezone: start.company.timezone,
        importedAt: batch.createdAt,
      });
      for (const proposal of normalized.newOptions) {
        const key = `${proposal.fieldKey}\n${proposal.option.value}`;
        if (options.has(key)) continue;
        options.add(key);
        result.newOptions.push(proposal);
      }
      const phone = normalized.lead.phoneE164;
      if (normalized.invalid) {
        result.counts.invalid++;
        preview._keep(
          result.invalidRows,
          batch,
          rowNo,
          row,
          normalized,
          "invalid",
          null,
          null,
        );
      } else if (!phone) {
        result.toAdd++;
        result.needPhoneReview++;
        preview._keep(
          result.phoneReview,
          batch,
          rowNo,
          row,
          normalized,
          "imported",
          null,
          "invalid_phone",
        );
      } else if (seen.has(phone)) {
        result.counts.duplicateFile++;
        preview._keep(
          result.duplicateFile,
          batch,
          rowNo,
          row,
          normalized,
          "duplicate_file",
          null,
          null,
        );
      } else {
        seen.add(phone);
        pending.push({ rowNo, row, normalized });
        if (pending.length === lookupSize) await flush();
      }
    }
    if (pending.length > 0) await flush();
    return result;
  },
  _classify(
    result: DryRunResult,
    batch: StoredBatch,
    pending: Pending[],
    matches: ImportMatch[],
  ): void {
    const byPhone = new Map(matches.map((match) => [match.phoneE164, match]));
    for (const { rowNo, row, normalized } of pending) {
      const { lead } = normalized;
      const match = byPhone.get(lead.phoneE164 ?? "");
      if (!match) {
        result.toAdd++;
        continue;
      }
      if (
        match.campaignName === lead.campaignName &&
        match.leadDate.getTime() === lead.leadDate.getTime()
      ) {
        result.sameSubmission++;
        continue;
      }
      result.counts.resubmitted++;
      preview._keep(
        result.resubmitted,
        batch,
        rowNo,
        row,
        normalized,
        "duplicate_db",
        match.leadId,
        "resubmitted",
      );
    }
  },
  _keep(
    list: PreviewRow[],
    batch: StoredBatch,
    rowNo: number,
    row: string[],
    normalized: NormalizedRow,
    result: PreviewRow["result"],
    leadId: string | null,
    reason: PreviewRow["reason"],
  ): void {
    if (list.length >= shown) return;
    list.push({
      id: `${batch.id}:${rowNo}`,
      batchId: batch.id,
      rowNo,
      raw: Object.fromEntries(
        batch.profile.columns.map((column) => [
          column.header,
          row[column.index] ?? "",
        ]),
      ),
      phoneE164: normalized.lead.phoneE164,
      result,
      leadId,
      reason,
      display: {
        fullName: normalized.lead.fullName,
        phoneRaw: normalized.lead.phoneRaw,
      },
      issues: normalized.issues,
    });
  },
  _asField(current: Ctx) {
    return (field: NewField): Field => ({
      id: field.key,
      companyId: current.companyId,
      key: field.key,
      label: field.label,
      type: field.type,
      options: field.options ?? null,
      isSystem: false,
      position: 0,
      archivedAt: null,
    });
  },
};
export default preview;
