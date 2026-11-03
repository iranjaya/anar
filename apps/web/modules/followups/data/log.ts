import { randomUUID } from "node:crypto";
import {
  type LogFollowUpResult,
  type LogFollowUpWireInput,
  logFollowUpInputSchema,
  logFollowUpResultSchema,
} from "@anar/domain/followups";
import { apiRequest } from "@/lib/api/client";
import { dataMode } from "@/lib/api/mode";
import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { applyFollowUp, getLead, getMyToday } from "@/modules/leads/server";
import type { FollowUp } from "@/modules/leads/types";
import { loadSchema } from "@/modules/settings/server";
import {
  can,
  type FeatureContext,
  verifyContext,
} from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";

export async function logFollowUp(
  view: FeatureContext,
  input: LogFollowUpWireInput,
): Promise<LogFollowUpResult> {
  if (dataMode() !== "demo") {
    if (!("capabilities" in view))
      throw new AppError("forbidden", "Sign in to use this company.");
    return apiRequest(
      {
        path: `/api/companies/${view.company.slug}/followups/logFollowUp`,
        method: "POST",
        body: input,
      },
      logFollowUpResultSchema,
    );
  }
  if ("capabilities" in view)
    throw new AppError("forbidden", "This is not available in the demo.");
  return demoLogFollowUp(view, input);
}

async function demoLogFollowUp(
  ctx: Ctx,
  input: LogFollowUpWireInput,
): Promise<LogFollowUpResult> {
  if (
    !logFollowUpInputSchema.shape.nextActionAt.safeParse(input.nextActionAt)
      .success
  )
    throw new AppError("validation", "Pick a valid follow-up date.");
  const current = await verifyContext(ctx);
  if (current.role === "dna" || !current.member)
    throw new AppError("forbidden", "DNA cannot log calls.");
  const { lead: before } = await getLead(current, input.leadId);
  if (!can(current, "followups.log", before))
    throw new AppError("forbidden", "You cannot log a call for this lead.");
  const schema = await loadSchema(current);
  if (!schema.outcomes.some((outcome) => outcome.id === input.outcomeId))
    throw new AppError("validation", "Pick an outcome in this company.");
  const today = await getMyToday(current);
  const bucket = [today.overdue, today.dueToday, today.newLeads].find((rows) =>
    rows.some((lead) => lead.id === input.leadId),
  );
  const data = await store();
  const followUp: FollowUp = {
    id: randomUUID(),
    companyId: current.companyId,
    leadId: before.id,
    byMemberId: current.member.id,
    byUserId: current.user.id,
    outcomeId: input.outcomeId,
    notes: input.notes ?? null,
    happenedAt: new Date(),
    nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null,
    stageBeforeId: before.stageId,
    stageAfterId: input.stageId ?? before.stageId,
  };
  const lead = await applyFollowUp(current, {
    leadId: before.id,
    followUpId: followUp.id,
    happenedAt: followUp.happenedAt,
    nextActionAt: followUp.nextActionAt,
    stageId: input.stageId,
    lostReasonId: input.lostReasonId ?? undefined,
  });
  followUp.nextActionAt = lead.nextActionAt;
  data.followUps.push(followUp);
  return {
    lead,
    followUp,
    lostSuggested:
      before.lostSuggestedAt === null && lead.lostSuggestedAt !== null,
    nextLeadId: bucket?.find((row) => row.id !== input.leadId)?.id ?? null,
  };
}
