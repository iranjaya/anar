import { z } from "zod";
import { wireDateSchema } from "./http.js";

export type Field = {
  id: string;
  companyId: string;
  key: string;
  label: string;
  type: "text" | "number" | "date" | "dropdown";
  options: { value: string; label: string }[] | null;
  isSystem: boolean;
  position: number;
  archivedAt: Date | null;
};
export type Stage = {
  id: string;
  companyId: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
  isDefault: boolean;
};
export type Outcome = {
  id: string;
  companyId: string;
  name: string;
  countsAsFailed: boolean;
  position: number;
};
export type LostReason = {
  id: string;
  companyId: string;
  name: string;
  position: number;
};
export type CompanySchema = {
  fields: Field[];
  stages: Stage[];
  outcomes: Outcome[];
  lostReasons: LostReason[];
};
export type SettingsCatalog = {
  fields: Field[];
  stages: (Stage & { archivedAt: Date | null })[];
  outcomes: (Outcome & { archivedAt: Date | null })[];
  lostReasons: (LostReason & { archivedAt: Date | null })[];
};

const name = z.string().trim().min(1).max(120);
const position = z.number().int().nonnegative();
const optionSchema = z.strictObject({
  value: z.string().min(1).max(120),
  label: name,
});
const fieldSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: name,
  type: z.enum(["text", "number", "date", "dropdown"]),
  options: z.array(optionSchema).nullable(),
  isSystem: z.boolean(),
  position,
  archivedAt: wireDateSchema.nullable(),
});
const stageSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  name,
  position,
  kind: z.enum(["open", "won", "lost"]),
  isDefault: z.boolean(),
});
const outcomeSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  name,
  countsAsFailed: z.boolean(),
  position,
});
const lostReasonSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  name,
  position,
});
const archivedAt = { archivedAt: wireDateSchema.nullable() };

export const companySchemaSchema = z.strictObject({
  fields: z.array(fieldSchema),
  stages: z.array(stageSchema),
  outcomes: z.array(outcomeSchema),
  lostReasons: z.array(lostReasonSchema),
});
export const settingsCatalogSchema = z.strictObject({
  fields: z.array(fieldSchema),
  stages: z.array(stageSchema.extend(archivedAt)),
  outcomes: z.array(outcomeSchema.extend(archivedAt)),
  lostReasons: z.array(lostReasonSchema.extend(archivedAt)),
});

export const fieldKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/)
  .refine((key) => key !== "base");
const dropdown = {
  type: z.literal("dropdown"),
  options: z
    .array(optionSchema)
    .min(1)
    .max(200)
    .refine(
      (options) =>
        new Set(options.map((option) => option.value)).size === options.length,
    ),
};
const plain = { type: z.enum(["text", "number", "date"]) };
export const fieldDefinitionSchema = z.discriminatedUnion("type", [
  z.strictObject(dropdown),
  z.strictObject(plain),
]);
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
const newField = { key: fieldKeySchema.optional(), label: name };
export const createFieldSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...newField, ...dropdown }),
  z.strictObject({ ...newField, ...plain }),
]);
export type CreateFieldInput = z.infer<typeof createFieldSchema>;
export const createFieldsSchema = z
  .array(createFieldSchema.and(z.object({ key: fieldKeySchema })))
  .min(1);
export type CreateFieldsInput = z.infer<typeof createFieldsSchema>;
export const fieldOptionAdditionsSchema = z
  .array(
    z.strictObject({
      fieldKey: fieldKeySchema,
      options: z.array(optionSchema).min(1),
    }),
  )
  .min(1);
export type FieldOptionAddition = z.infer<
  typeof fieldOptionAdditionsSchema
>[number];
export const fieldIdSchema = z.strictObject({ fieldId: z.uuid() });

// A label that slugs to nothing usable means the user must type a key.
export function fieldKeyFromLabel(label: string): string | null {
  const key = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return fieldKeySchema.safeParse(key).success ? key : null;
}
export const updateFieldSchema = z
  .strictObject({
    fieldId: z.uuid(),
    label: name.optional(),
    position: position.optional(),
    definition: fieldDefinitionSchema.optional(),
  })
  .refine(
    (input) =>
      input.label !== undefined ||
      input.position !== undefined ||
      input.definition !== undefined,
  );
export type UpdateFieldInput = z.infer<typeof updateFieldSchema>;
export const stageInputSchema = z.strictObject({
  id: z.uuid().optional(),
  name,
  kind: z.enum(["open", "won", "lost"]),
  isDefault: z.boolean(),
});
export type StageInput = z.infer<typeof stageInputSchema>;
export const reorderStagesSchema = z.strictObject({
  stageIds: z
    .array(z.uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type ReorderStagesInput = z.infer<typeof reorderStagesSchema>;
export const stageIdSchema = z.strictObject({ stageId: z.uuid() });
export const outcomeInputSchema = z.strictObject({
  id: z.uuid().optional(),
  name,
  countsAsFailed: z.boolean(),
});
export type OutcomeInput = z.infer<typeof outcomeInputSchema>;
export const outcomeIdSchema = z.strictObject({ outcomeId: z.uuid() });
export const lostReasonInputSchema = z.strictObject({
  id: z.uuid().optional(),
  name,
});
export type LostReasonInput = z.infer<typeof lostReasonInputSchema>;
export const lostReasonIdSchema = z.strictObject({ lostReasonId: z.uuid() });
