import "server-only";
import { slugSchema } from "@anar/domain/agencies";
import { okSchema } from "@anar/domain/auth";
import {
  createFieldSchema,
  fieldIdSchema,
  lostReasonIdSchema,
  lostReasonInputSchema,
  outcomeIdSchema,
  outcomeInputSchema,
  type SettingsCatalog,
  reorderStagesSchema,
  settingsCatalogSchema,
  stageIdSchema,
  stageInputSchema,
  updateFieldSchema,
} from "@anar/domain/settings";
import type { z } from "zod";
import { apiRequest } from "@/lib/api/client";
import { authEnabled } from "@/lib/api/mode";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";

export { createFields, loadSchema } from "./data/schema";

const catalogSchema = settingsCatalogSchema.transform(
  (catalog): SettingsCatalog => {
    const toDate = <T extends { archivedAt: string | null }>(row: T) => ({
      ...row,
      archivedAt: row.archivedAt === null ? null : new Date(row.archivedAt),
    });
    return {
      fields: catalog.fields.map(toDate),
      stages: catalog.stages.map(toDate),
      outcomes: catalog.outcomes.map(toDate),
      lostReasons: catalog.lostReasons.map(toDate),
    };
  },
);

export async function getSettings(
  slug: string,
): Promise<ActionResult<SettingsCatalog> | null> {
  if (!authEnabled()) return null;
  try {
    const parsed = slugSchema.safeParse(slug);
    if (!parsed.success) throw new AppError("not_found", "Company not found.");
    const data = await apiRequest(
      { path: `/api/companies/${parsed.data}/settings/getSettings` },
      catalogSchema,
    );
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

async function write<T>(
  slug: string,
  operation: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!authEnabled())
    throw new AppError("unavailable", "Settings are not available yet.");
  const company = slugSchema.safeParse(slug);
  if (!company.success) throw new AppError("not_found", "Company not found.");
  return apiRequest(
    {
      path: `/api/companies/${company.data}/settings/${operation}`,
      method: "POST",
      body,
    },
    schema,
  );
}

export function createField(slug: string, input: unknown) {
  const parsed = createFieldSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Check the field name, key and choices.");
  return write(slug, "createField", parsed.data, fieldIdSchema);
}

export function updateField(slug: string, input: unknown) {
  const parsed = updateFieldSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Check the field name and choices.");
  return write(slug, "updateField", parsed.data, okSchema);
}

export function archiveField(slug: string, fieldId: string) {
  const parsed = fieldIdSchema.safeParse({ fieldId });
  if (!parsed.success)
    throw new AppError("validation", "Choose a field to archive.");
  return write(slug, "archiveField", parsed.data, okSchema);
}

export function upsertStage(slug: string, input: unknown) {
  const parsed = stageInputSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Check the stage name and type.");
  return write(slug, "upsertStage", parsed.data, okSchema);
}

export function reorderStages(slug: string, stageIds: string[]) {
  const parsed = reorderStagesSchema.safeParse({ stageIds });
  if (!parsed.success)
    throw new AppError("validation", "Reload the page and try again.");
  return write(slug, "reorderStages", parsed.data, okSchema);
}

export function archiveStage(slug: string, stageId: string) {
  const parsed = stageIdSchema.safeParse({ stageId });
  if (!parsed.success)
    throw new AppError("validation", "Choose a stage to archive.");
  return write(slug, "archiveStage", parsed.data, okSchema);
}

export function upsertOutcome(slug: string, input: unknown) {
  const parsed = outcomeInputSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Check the outcome name.");
  return write(slug, "upsertOutcome", parsed.data, okSchema);
}

export function archiveOutcome(slug: string, outcomeId: string) {
  const parsed = outcomeIdSchema.safeParse({ outcomeId });
  if (!parsed.success)
    throw new AppError("validation", "Choose an outcome to archive.");
  return write(slug, "archiveOutcome", parsed.data, okSchema);
}

export function upsertLostReason(slug: string, input: unknown) {
  const parsed = lostReasonInputSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Check the reason name.");
  return write(slug, "upsertLostReason", parsed.data, okSchema);
}

export function archiveLostReason(slug: string, lostReasonId: string) {
  const parsed = lostReasonIdSchema.safeParse({ lostReasonId });
  if (!parsed.success)
    throw new AppError("validation", "Choose a reason to archive.");
  return write(slug, "archiveLostReason", parsed.data, okSchema);
}
