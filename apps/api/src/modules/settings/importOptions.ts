import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type FieldOptionAddition,
  fieldDefinitionSchema,
  fieldOptionAdditionsSchema,
} from "@anar/domain/settings";
import audit from "../tenant/audit.js";
import type { Ctx } from "../tenant/index.js";
import guard, { type Meta } from "./guard.js";
import repository from "./repository.js";

const importOptions = {
  // Appends answer codes an import found; codes already there keep their label.
  async extendFieldOptions(
    tx: TenantTx,
    current: Ctx,
    input: FieldOptionAddition[],
    meta: Meta,
  ): Promise<void> {
    guard.manage(current, meta);
    const parsed = fieldOptionAdditionsSchema.safeParse(input);
    const keys = parsed.success
      ? parsed.data.map((addition) => addition.fieldKey)
      : [];
    if (!parsed.success || new Set(keys).size !== keys.length)
      throw new AppError("validation", "Check the new answers");
    const locked = await repository.lockFieldsByKey(tx, keys);
    const byKey = new Map(locked.map((field) => [field.key, field]));
    for (const { fieldKey, options } of parsed.data) {
      const field = byKey.get(fieldKey);
      if (!field || field.archivedAt)
        throw new AppError("conflict", `Field ${fieldKey} is no longer active`);
      if (field.isSystem || field.type !== "dropdown")
        throw new AppError(
          "conflict",
          `Field ${fieldKey} is no longer a dropdown`,
        );
      const kept = field.options ?? [];
      const codes = new Set(kept.map((option) => option.value));
      const added = options.filter((option) => !codes.has(option.value));
      if (added.length === 0) continue;
      const definition = fieldDefinitionSchema.safeParse({
        type: "dropdown",
        options: [...kept, ...added],
      });
      if (!definition.success)
        throw new AppError(
          "validation",
          `Field ${fieldKey} can hold at most 200 answers, each with its own code`,
        );
      await repository.updateField(tx, field.id, {
        options: [...kept, ...added],
        updatedAt: meta.at,
      });
      await audit.audit(
        tx,
        guard.actor(current, meta),
        "settings.field_updated",
        { type: "field", id: field.id },
        { fieldId: field.id },
      );
    }
  },
};
export default importOptions;
