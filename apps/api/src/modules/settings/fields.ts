import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import type { ReferenceCounts, ReferenceInput } from "@anar/domain/leads";
import {
  type CreateFieldsInput,
  createFieldSchema,
  createFieldsSchema,
  type Field,
  type FieldDefinition,
  fieldIdSchema,
  fieldKeyFromLabel,
  updateFieldSchema,
} from "@anar/domain/settings";
import { v7 } from "uuid";
import audit from "../tenant/audit.js";
import type { Ctx } from "../tenant/index.js";
import defaults from "./defaults.js";
import guard, { type Meta } from "./guard.js";
import repository from "./repository.js";

export type SettingsReferenceReader = (
  tx: TenantTx,
  input: ReferenceInput,
) => Promise<ReferenceCounts>;

// Scoring rules point at these keys until S9 lets a manager change the rules.
const scoringKeys = new Set(defaults.fieldSeeds.map((seed) => seed.key));

const fields = {
  // The import hand-off: all fields are checked before any is written, then inserted together.
  async createFields(
    tx: TenantTx,
    current: Ctx,
    input: CreateFieldsInput,
    meta: Meta,
  ): Promise<Field[]> {
    guard.manage(current, meta);
    const parsed = createFieldsSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError("validation", "Check the new field names and options");
    const keys = new Set(await repository.fieldKeys(tx));
    for (const field of parsed.data) {
      if (keys.has(field.key))
        throw new AppError("conflict", "A field with this key already exists");
      keys.add(field.key);
    }
    const position = await repository.nextFieldPosition(tx);
    const rows = await repository.insertFields(
      tx,
      parsed.data.map((field, index) => ({
        id: v7(),
        companyId: current.companyId,
        key: field.key,
        label: field.label,
        type: field.type,
        options: field.type === "dropdown" ? field.options : null,
        isSystem: false,
        position: position + index,
      })),
    );
    for (const row of rows)
      await audit.audit(
        tx,
        guard.actor(current, meta),
        "settings.field_created",
        { type: "field", id: row.id },
        { fieldId: row.id },
      );
    return rows;
  },
  async createField(
    tx: TenantTx,
    current: Ctx,
    input: unknown,
    meta: Meta,
  ): Promise<{ fieldId: string }> {
    const parsed = createFieldSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError("validation", "Check the field name and options");
    const key = parsed.data.key ?? fieldKeyFromLabel(parsed.data.label);
    if (!key) throw new AppError("validation", "Type a key for this field");
    const [row] = await fields.createFields(
      tx,
      current,
      [{ ...parsed.data, key }],
      meta,
    );
    return { fieldId: row.id };
  },
  async updateField(
    tx: TenantTx,
    current: Ctx,
    input: unknown,
    meta: Meta,
    references: SettingsReferenceReader,
  ): Promise<{ ok: true }> {
    guard.manage(current, meta);
    const parsed = updateFieldSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError("validation", "Check the field changes");
    const { fieldId, label, position, definition } = parsed.data;
    const field = await fields._lockEditable(tx, fieldId);
    if (definition) {
      const { leadCount } = await references(tx, {
        kind: "field",
        fieldKey: field.key,
      });
      if (leadCount > 0 || scoringKeys.has(field.key))
        fields._requireKeptCodes(field, definition);
    }
    await repository.updateField(tx, fieldId, {
      label,
      position,
      ...(definition && {
        type: definition.type,
        options: definition.type === "dropdown" ? definition.options : null,
      }),
      updatedAt: meta.at,
    });
    await audit.audit(
      tx,
      guard.actor(current, meta),
      "settings.field_updated",
      { type: "field", id: fieldId },
      { fieldId },
    );
    return { ok: true };
  },
  async archiveField(
    tx: TenantTx,
    current: Ctx,
    input: unknown,
    meta: Meta,
  ): Promise<{ ok: true }> {
    guard.manage(current, meta);
    const parsed = fieldIdSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError("validation", "Choose a field to archive");
    const { fieldId } = parsed.data;
    const field = await fields._lockEditable(tx, fieldId);
    if (scoringKeys.has(field.key))
      throw new AppError("conflict", "Scoring uses this field, so it stays");
    if (field.archivedAt) return { ok: true };
    await repository.updateField(tx, fieldId, {
      archivedAt: meta.at,
      updatedAt: meta.at,
    });
    await audit.audit(
      tx,
      guard.actor(current, meta),
      "settings.field_archived",
      { type: "field", id: fieldId },
      { fieldId },
    );
    return { ok: true };
  },
  async _lockEditable(tx: TenantTx, fieldId: string) {
    const field = await repository.lockField(tx, fieldId);
    if (!field) throw new AppError("not_found", "Field not found");
    if (field.isSystem)
      throw new AppError("conflict", "System fields cannot change");
    return field;
  },
  // Stored answers use the codes, so a used field keeps its type and every code it has.
  _requireKeptCodes(
    field: { type: string; options: { value: string }[] | null },
    definition: FieldDefinition,
  ): void {
    const codes = new Set(
      definition.type === "dropdown"
        ? definition.options.map((option) => option.value)
        : [],
    );
    if (
      definition.type !== field.type ||
      field.options?.some((option) => !codes.has(option.value))
    )
      throw new AppError(
        "conflict",
        "Leads already use this field, so its type and codes must stay",
      );
  },
};
export default fields;
