"use server";

import type { AssignLeadsInput } from "@anar/domain/assignment";
import type {
  ChangeStageInput,
  UpdateLeadFieldsInput,
} from "@anar/domain/leads";
import { revalidatePath } from "next/cache";
import { type ActionResult, actionFailure } from "@/lib/errors";
import { assignLeads } from "./data/assignment";
import { updateLeadFields } from "./data/editFields";
import { changeStage } from "./data/stageChange";

export async function updateLeadFieldsAction(
  slug: string,
  input: UpdateLeadFieldsInput,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const data = await updateLeadFields(slug, input);
    revalidatePath(`/${slug}/leads/${input.leadId}`);
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function changeStageAction(
  slug: string,
  input: ChangeStageInput,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const data = await changeStage(slug, input);
    revalidatePath(`/${slug}/leads/${input.leadId}`);
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function assignLeadsRealAction(
  input: { slug: string } & AssignLeadsInput,
): Promise<ActionResult<{ updated: number }>> {
  try {
    const { slug, ...rest } = input;
    const data = await assignLeads(slug, rest);
    revalidatePath(`/${slug}`, "layout");
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}
