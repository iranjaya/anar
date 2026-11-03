import { AppError } from "@anar/domain/errors";
import {
  type ImportDraft,
  type ImportDraftInput,
  importDraftInputSchema,
} from "@anar/domain/imports";
import { createFieldsSchema, type Field } from "@anar/domain/settings";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import repository, { type StoredBatch } from "./repository.js";
import type { ImportDeps } from "./service.js";

const draft = {
  async saveImportDraft(
    deps: ImportDeps,
    actor: Ctx,
    raw: ImportDraftInput,
  ): Promise<ImportDraft> {
    const parsed = importDraftInputSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("validation", "Check the column choices");
    const input = parsed.data;
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
      draft.validate(input, batch, (await deps.loadSchema(tx)).fields);
      const saved = {
        mapping: input.mapping,
        newFields: input.newFields,
        ...(input.saveTemplate ? { saveTemplate: input.saveTemplate } : {}),
        preview: null,
      };
      const revision = batch.previewRevision + 1;
      await repository.saveDraft(tx, batch.id, saved, revision);
      return { batchId: batch.id, ...saved, revision };
    });
  },
  async getImportDraft(
    deps: ImportDeps,
    actor: Ctx,
    batchId: string,
  ): Promise<ImportDraft | null> {
    return deps.context.withContext(actor, async (tx, current) => {
      permissions.require(current, "imports.upload");
      const batch = await repository.readBatch(tx, batchId);
      if (!batch) throw new AppError("not_found", "Import not found");
      if (!batch.draft) return null;
      const { snapshot, ...saved } = batch.draft;
      return { batchId, ...saved, revision: batch.previewRevision };
    });
  },
  // New fields are checked as if they already existed; nothing is written to settings here.
  validate(
    input: Pick<ImportDraftInput, "mapping" | "newFields">,
    batch: StoredBatch,
    fields: Field[],
  ): void {
    const headers = batch.profile.columns.map((column) => column.header);
    const mapped = input.mapping.map((row) => row.header);
    if (
      mapped.length !== headers.length ||
      new Set(mapped).size !== mapped.length ||
      headers.some((header) => !mapped.includes(header))
    )
      throw new AppError("validation", "Choose a target for every column");
    const targets = input.mapping.filter((row) => row.target !== "skip");
    if (targets.filter((row) => row.target === "system:phone").length !== 1)
      throw new AppError("validation", "Match exactly one column to Phone");
    const seen = new Map<string, string>();
    for (const { header, target } of targets) {
      const first = seen.get(target);
      if (first)
        throw new AppError(
          "validation",
          `Columns ${first} and ${header} go to the same place`,
        );
      seen.set(target, header);
    }
    const active = new Set(fields.map((field) => field.key));
    const added = new Map(input.newFields.map((field) => [field.key, field]));
    if (
      added.size !== input.newFields.length ||
      input.newFields.some((field) => active.has(field.key))
    )
      throw new AppError("validation", "Each new field needs its own key");
    const definitions = createFieldsSchema.safeParse(
      input.newFields.map(({ header, ...field }) => field),
    );
    if (input.newFields.length > 0 && !definitions.success)
      throw new AppError(
        "validation",
        "Give each new field a valid key, label and answer labels",
      );
    for (const { header, target } of targets) {
      if (!target.startsWith("field:")) continue;
      const key = target.slice("field:".length);
      if (active.has(key)) continue;
      const field = added.get(key);
      if (!field)
        throw new AppError(
          "validation",
          `Column ${header} goes to a field that is no longer active. Choose another target`,
        );
      if (field.header !== header)
        throw new AppError(
          "validation",
          `New field ${key} belongs to column ${field.header}`,
        );
    }
    for (const field of input.newFields)
      if (seen.get(`field:${field.key}`) !== field.header)
        throw new AppError(
          "validation",
          `New field ${field.key} is not used by any column`,
        );
  },
};
export default draft;
