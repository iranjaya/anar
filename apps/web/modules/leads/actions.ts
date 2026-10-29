"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";
import { can, requireContext } from "@/modules/tenant/server";
import {
  assignLeads,
  changeStage,
  dismissLostSuggestion,
  getLead,
} from "./server";
import type { Lead } from "./types";

const leadInput = z.object({
  slug: z.string().min(1),
  leadId: z.string().min(1),
});

export async function changeStageAction(input: {
  slug: string;
  leadId: string;
  stageId: string;
  lostReasonId?: string;
}): Promise<ActionResult<{ lead: Lead }>> {
  const parsed = leadInput
    .extend({
      stageId: z.string().min(1),
      lostReasonId: z.string().min(1).optional(),
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: "validation",
      message: "Pick a stage and a valid reason.",
    };
  try {
    const ctx = await requireContext(parsed.data.slug);
    const { lead } = await getLead(ctx, parsed.data.leadId);
    if (!can(ctx, "leads.update", lead))
      throw new AppError("forbidden", "You cannot update this lead.");
    const data = await changeStage(ctx, parsed.data);
    revalidatePath(`/${parsed.data.slug}`, "layout");
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function dismissLostSuggestionAction(input: {
  slug: string;
  leadId: string;
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = leadInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "validation", message: "Choose a lead." };
  try {
    const ctx = await requireContext(parsed.data.slug);
    if (!can(ctx, "leads.assign"))
      throw new AppError("forbidden", "Only a manager can keep trying.");
    const data = await dismissLostSuggestion(ctx, parsed.data.leadId);
    revalidatePath(`/${parsed.data.slug}`, "layout");
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function assignLeadsAction(input: {
  slug: string;
  leadIds: string[];
  memberId: string;
}): Promise<ActionResult<{ updated: number }>> {
  const parsed = z
    .object({
      slug: z.string().min(1),
      leadIds: z.array(z.string().min(1)).min(1).max(500),
      memberId: z.string().min(1),
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: "validation",
      message: "Select leads and a person to assign to.",
    };
  try {
    const ctx = await requireContext(parsed.data.slug);
    if (!can(ctx, "leads.assign"))
      throw new AppError("forbidden", "Only a manager can assign leads.");
    const data = await assignLeads(ctx, parsed.data);
    revalidatePath(`/${parsed.data.slug}`, "layout");
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}
