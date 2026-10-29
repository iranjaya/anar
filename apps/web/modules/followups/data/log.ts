import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { applyFollowUp, getLead } from "@/modules/leads/server";
import type { FollowUp, Lead } from "@/modules/leads/types";
import { loadSchema } from "@/modules/settings/server";
import { can, verifyContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";

export async function logFollowUp(
  ctx: Ctx,
  input: {
    leadId: string;
    outcomeId: string;
    notes?: string;
    nextActionAt?: Date | null;
    stageId?: string;
    lostReasonId?: string;
  },
): Promise<{ lead: Lead; followUp: FollowUp; lostSuggested: boolean }> {
  const current = await verifyContext(ctx);
  if (current.role === "dna" || !current.member)
    throw new AppError("forbidden", "DNA cannot log calls.");
  const { lead: before } = await getLead(current, input.leadId);
  if (!can(current, "followups.log", before))
    throw new AppError("forbidden", "You cannot log a call for this lead.");
  const schema = await loadSchema(current);
  if (!schema.outcomes.some((outcome) => outcome.id === input.outcomeId))
    throw new AppError("validation", "Pick an outcome in this company.");
  if (input.nextActionAt && !Number.isFinite(input.nextActionAt.getTime()))
    throw new AppError("validation", "Pick a valid follow-up date.");
  const data = await store();
  const followUp: FollowUp = {
    id: randomUUID(),
    companyId: current.companyId,
    leadId: before.id,
    byMemberId: current.member.id,
    outcomeId: input.outcomeId,
    notes: input.notes?.trim() || null,
    happenedAt: new Date(),
    nextActionAt: input.nextActionAt ?? null,
    stageBeforeId: before.stageId,
    stageAfterId: input.stageId ?? before.stageId,
  };
  const lead = await applyFollowUp(current, {
    leadId: before.id,
    followUpId: followUp.id,
    happenedAt: followUp.happenedAt,
    nextActionAt: followUp.nextActionAt,
    stageId: input.stageId,
    lostReasonId: input.lostReasonId,
  });
  followUp.nextActionAt = lead.nextActionAt;
  if (schema.stages.find((stage) => stage.id === lead.stageId)?.kind === "lost")
    followUp.notes = null;
  data.followUps.push(followUp);
  return { lead, followUp, lostSuggested: lead.lostSuggestedAt !== null };
}
