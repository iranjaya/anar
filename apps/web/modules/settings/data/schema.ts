import { z } from "zod";
import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import type { NewField } from "@/modules/imports/types";
import { can, verifyContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import type { CompanySchema, Field } from "../types";

export async function loadSchema(ctx: Ctx): Promise<CompanySchema> {
  const current = await verifyContext(ctx);
  const data = await store();
  return {
    fields: data.fields.filter(
      (field) =>
        field.companyId === current.companyId && field.archivedAt === null,
    ),
    stages: data.stages.filter(
      (stage) => stage.companyId === current.companyId,
    ),
    outcomes: data.outcomes.filter(
      (outcome) => outcome.companyId === current.companyId,
    ),
    lostReasons: data.lostReasons.filter(
      (reason) => reason.companyId === current.companyId,
    ),
  };
}

export async function createFields(
  ctx: Ctx,
  fields: NewField[],
): Promise<Field[]> {
  const parsed = z
    .array(
      z.object({
        header: z.string(),
        key: z.string().regex(/^[a-z][a-z0-9_]*$/),
        label: z.string().trim().min(1),
        type: z.enum(["text", "number", "date", "dropdown"]),
        options: z
          .array(
            z.object({
              value: z.string().min(1),
              label: z.string().trim().min(1),
            }),
          )
          .optional(),
      }),
    )
    .safeParse(fields);
  if (!parsed.success)
    throw new AppError("validation", "Check the new field names and options.");
  const current = await verifyContext(ctx);
  if (!can(current, "settings.manage"))
    throw new AppError("forbidden", "You cannot create fields.");
  const data = await store();
  const existing = data.fields.filter(
    (field) => field.companyId === current.companyId,
  );
  const keys = new Set(existing.map((field) => field.key));
  for (const field of parsed.data) {
    if (keys.has(field.key))
      throw new AppError("conflict", "A field with this key already exists.");
    if (field.type === "dropdown" && !field.options?.length)
      throw new AppError("validation", "Add options for the dropdown.");
    if (
      field.options &&
      new Set(field.options.map((option) => option.value)).size !==
        field.options.length
    )
      throw new AppError("validation", "Option codes must be unique.");
    keys.add(field.key);
  }
  const nextPosition =
    Math.max(-1, ...existing.map((field) => field.position)) + 1;
  const added: Field[] = parsed.data.map((field, index) => ({
    id: `${current.companyId}-${field.key}`,
    companyId: current.companyId,
    key: field.key,
    label: field.label,
    type: field.type,
    options: field.type === "dropdown" ? (field.options ?? []) : null,
    isSystem: false,
    position: nextPosition + index,
    archivedAt: null,
  }));
  data.fields.push(...added);
  return added;
}
