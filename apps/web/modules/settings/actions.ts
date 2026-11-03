"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, actionFailure } from "@/lib/errors";
import {
  archiveField,
  archiveLostReason,
  archiveOutcome,
  archiveStage,
  createField,
  reorderStages,
  updateField,
  upsertLostReason,
  upsertOutcome,
  upsertStage,
} from "./server";

function definition(form: FormData) {
  const type = String(form.get("type") ?? "");
  if (type !== "dropdown") return { type };
  const labels = form.getAll("optionLabel").map(String);
  return {
    type,
    options: form.getAll("optionValue").map((value, index) => ({
      value: String(value),
      label: labels[index] ?? "",
    })),
  };
}

async function run<T>(
  slug: string,
  write: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const data = await write();
    revalidatePath(`/${slug}/settings`);
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function createFieldAction(
  slug: string,
  _previous: ActionResult<{ fieldId: string }> | null,
  form: FormData,
): Promise<ActionResult<{ fieldId: string }>> {
  const key = String(form.get("key") ?? "").trim();
  return run(slug, () =>
    createField(slug, {
      label: String(form.get("label") ?? ""),
      ...(key ? { key } : {}),
      ...definition(form),
    }),
  );
}

export async function updateFieldAction(
  slug: string,
  fieldId: string,
  _previous: ActionResult<{ ok: true }> | null,
  form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return run(slug, () =>
    updateField(slug, {
      fieldId,
      label: String(form.get("label") ?? ""),
      definition: definition(form),
    }),
  );
}

export async function archiveFieldAction(
  slug: string,
  fieldId: string,
  _previous: ActionResult<{ ok: true }> | null,
  _form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return run(slug, () => archiveField(slug, fieldId));
}

export async function upsertStageAction(
  slug: string,
  _previous: ActionResult<{ ok: true }> | null,
  form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  const id = String(form.get("id") ?? "");
  return run(slug, () =>
    upsertStage(slug, {
      ...(id ? { id } : {}),
      name: String(form.get("name") ?? ""),
      kind: String(form.get("kind") ?? ""),
      isDefault: form.get("isDefault") === "on",
    }),
  );
}

export async function reorderStagesAction(
  slug: string,
  stageIds: string[],
  _previous: ActionResult<{ ok: true }> | null,
  _form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return run(slug, () => reorderStages(slug, stageIds));
}

export async function archiveStageAction(
  slug: string,
  stageId: string,
  _previous: ActionResult<{ ok: true }> | null,
  _form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return run(slug, () => archiveStage(slug, stageId));
}

export async function upsertOutcomeAction(
  slug: string,
  outcomeId: string | null,
  _previous: ActionResult<{ ok: true }> | null,
  form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return run(slug, () =>
    upsertOutcome(slug, {
      ...(outcomeId ? { id: outcomeId } : {}),
      name: String(form.get("name") ?? ""),
      countsAsFailed: form.get("flag") === "on",
    }),
  );
}

export async function archiveOutcomeAction(
  slug: string,
  outcomeId: string,
  _previous: ActionResult<{ ok: true }> | null,
  _form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return run(slug, () => archiveOutcome(slug, outcomeId));
}

export async function upsertLostReasonAction(
  slug: string,
  lostReasonId: string | null,
  _previous: ActionResult<{ ok: true }> | null,
  form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return run(slug, () =>
    upsertLostReason(slug, {
      ...(lostReasonId ? { id: lostReasonId } : {}),
      name: String(form.get("name") ?? ""),
    }),
  );
}

export async function archiveLostReasonAction(
  slug: string,
  lostReasonId: string,
  _previous: ActionResult<{ ok: true }> | null,
  _form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return run(slug, () => archiveLostReason(slug, lostReasonId));
}
