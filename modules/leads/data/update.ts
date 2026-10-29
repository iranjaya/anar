import { AppError } from "@/lib/errors";
import { can } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import type { Lead } from "../types";
import { readVisibleLead } from "./detail";
import { applyStageChange, clearLostSuggestion } from "./write";

export async function changeStage(
  ctx: Ctx,
  input: {
    leadId: string;
    stageId: string;
    lostReasonId?: string;
  },
): Promise<{ lead: Lead }> {
  const { current, data, lead } = await readVisibleLead(ctx, input.leadId);
  if (!can(current, "leads.update", lead))
    throw new AppError("forbidden", "You cannot update this lead.");
  const stage = data.stages.find(
    (stage) =>
      stage.companyId === current.companyId && stage.id === input.stageId,
  );
  if (!stage) throw new AppError("validation", "Pick a stage in this company.");
  if (
    stage.kind === "lost" &&
    !data.lostReasons.some(
      (reason) =>
        reason.companyId === current.companyId &&
        reason.id === input.lostReasonId,
    )
  )
    throw new AppError("validation", "Pick why it was lost.");
  return applyStageChange(
    data,
    current,
    lead,
    stage,
    stage.kind === "lost" ? (input.lostReasonId ?? null) : null,
  );
}

export async function dismissLostSuggestion(
  ctx: Ctx,
  leadId: string,
): Promise<{ ok: true }> {
  const { current, data, lead } = await readVisibleLead(ctx, leadId);
  if (!can(current, "leads.assign"))
    throw new AppError("forbidden", "Only a manager can keep trying.");
  return clearLostSuggestion(data, current, lead);
}
