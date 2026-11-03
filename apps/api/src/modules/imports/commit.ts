import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type CommitImportInput,
  type CommitImportResult,
  commitImportInputSchema,
} from "@anar/domain/imports";
import { createFieldsSchema } from "@anar/domain/settings";
import { v7 } from "uuid";
import audit from "../tenant/audit.js";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import commitSnapshot, { type SettingsPlan } from "./commitSnapshot.js";
import draft from "./draft.js";
import mapping from "./mapping.js";
import repository, { type StoredBatch } from "./repository.js";
import type { ImportDeps } from "./service.js";
import type { FrozenImport } from "./types.js";

type Meta = { at: Date; ip: string | null };
type Checked = { batch: StoredBatch; plan: SettingsPlan };

const commit = {
  // Settings changes, the frozen choices, the run and its job land together or not at all.
  async commitImport(
    deps: ImportDeps,
    actor: Ctx,
    raw: CommitImportInput,
    request: { ip: string | null },
  ): Promise<CommitImportResult> {
    const parsed = commitImportInputSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("validation", "Check the column choices");
    const input = parsed.data;
    const meta = { at: deps.now(), ip: request.ip };
    return deps.context.withContext(actor, async (tx, current) => {
      permissions.require(current, "imports.commit");
      const checked = await commit._check(tx, current, input);
      if (checked.batch.status !== "uploaded")
        return commit._replay(tx, checked);
      const { batch, plan } = checked;
      const snapshot = batch.draft?.snapshot;
      const before = (await deps.loadSchema(tx)).fields;
      if (
        !snapshot ||
        commitSnapshot.schemaFingerprint(before, current.company) !==
          snapshot.schemaFingerprint
      )
        throw new AppError(
          "conflict",
          "Company fields changed since the check. Check the file again",
        );
      draft.validate(input, batch, before);
      await commit._applySettings(deps, tx, current, plan, meta);
      const after = await deps.loadSchema(tx);
      const stage = after.stages.find((row) => row.isDefault);
      if (!stage)
        throw new AppError("conflict", "Choose a default stage first");
      const frozen: FrozenImport = {
        ...snapshot,
        schemaFingerprint: commitSnapshot.schemaFingerprint(
          after.fields,
          current.company,
        ),
        mappingRevision: batch.previewRevision,
        mapping: input.mapping,
        newFields: input.newFields,
        approvedOptions: plan.additions,
        fields: after.fields,
        defaultCountry: current.company.defaultCountry,
        timezone: current.company.timezone,
        defaultStageId: stage.id,
        newOptionsAdded: batch.draft?.preview?.newOptions.length ?? 0,
      };
      const templateId = await repository.useTemplate(
        tx,
        {
          id: v7(),
          companyId: current.companyId,
          name: input.saveTemplate?.name ?? "",
          headerFingerprint: mapping.fingerprint(batch.profile.columns),
          headers: batch.profile.columns.map((column) => column.header),
          mapping: input.mapping,
          createdBy: current.user.id,
          lastUsedAt: meta.at,
        },
        Boolean(input.saveTemplate),
      );
      const runId = v7();
      await repository.insertRun(tx, {
        id: runId,
        companyId: current.companyId,
        batchId: batch.id,
        runNo: 1,
        actorUserId: current.user.id,
        role: current.role === "agency_staff" ? "agency_staff" : "super_admin",
        authorizedAt: meta.at,
        mappingRevision: batch.previewRevision,
        state: "queued",
      });
      await repository.updateBatch(tx, batch.id, {
        status: "mapped",
        mapping: input.mapping,
        mappingTemplateId: templateId,
        frozen,
        activeRunId: runId,
      });
      const payload = {
        agencyId: current.agencyId,
        companyId: current.companyId,
        actorUserId: current.user.id,
        batchId: batch.id,
        runId,
      };
      const jobId = await deps.enqueue(
        tx,
        "import.commit",
        payload,
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
          ip: meta.ip,
        },
        "imports.committed",
        { type: "import_batch", id: batch.id },
        { batchId: batch.id, runId },
      );
      return { jobId };
    });
  },
  // The saved check must be for exactly these choices and this file.
  async _check(
    tx: TenantTx,
    current: Ctx,
    input: CommitImportInput,
  ): Promise<Checked> {
    const batch = await repository.lockBatch(tx, input.batchId);
    if (!batch) throw new AppError("not_found", "Import not found");
    const snapshot = batch.frozen ?? batch.draft?.snapshot;
    const preview = batch.draft?.preview;
    if (
      !snapshot ||
      !preview ||
      batch.previewRevision !== input.previewRevision ||
      input.expectedRevision !== input.previewRevision
    )
      throw new AppError(
        "conflict",
        "These choices were not checked. Check the file again",
      );
    const plan = commitSnapshot.plan(input.newFields, preview.newOptions);
    const commitHash = commitSnapshot.hash({
      fileSha256: snapshot.fileSha256,
      mapping: input.mapping,
      plan,
      company: current.company,
    });
    if (commitHash !== snapshot.commitHash)
      throw new AppError(
        "conflict",
        "These choices changed since the check. Check the file again",
      );
    return { batch, plan };
  },
  // A lost response or a second click gets the job that was already started.
  async _replay(tx: TenantTx, { batch }: Checked): Promise<CommitImportResult> {
    const run = batch.activeRunId
      ? await repository.lockRun(tx, batch.activeRunId)
      : null;
    if (!run?.jobId)
      throw new AppError("conflict", "This import has already started");
    return { jobId: run.jobId };
  },
  async _applySettings(
    deps: ImportDeps,
    tx: TenantTx,
    current: Ctx,
    plan: SettingsPlan,
    meta: Meta,
  ): Promise<void> {
    if (plan.newFields.length > 0) {
      const used = new Set(await deps.fieldKeys(tx));
      const taken = plan.newFields.find((field) => used.has(field.key));
      if (taken)
        throw new AppError(
          "validation",
          `An archived field already uses the key ${taken.key}. Choose another key`,
        );
      const fields = createFieldsSchema.safeParse(plan.newFields);
      if (!fields.success)
        throw new AppError(
          "validation",
          "Give each new field a valid key, label and answer labels",
        );
      await deps.createFields(tx, current, fields.data, meta);
    }
    if (plan.additions.length > 0)
      await deps.extendFieldOptions(tx, current, plan.additions, meta);
  },
};
export default commit;
