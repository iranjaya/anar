import "server-only";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import type { MockStore } from "@/mock/store";
import type { Stage } from "@/modules/settings/types";
import { can } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import type { Lead, LeadEventType } from "../types";

export async function addImportedLeads(
  ctx: Ctx,
  leads: Lead[],
): Promise<{ added: number }> {
  if (
    !can(ctx, "imports.commit") ||
    ctx.session.actingCompanyId !== ctx.companyId
  ) {
    throw new AppError(
      "forbidden",
      "Enter this company as DNA to import leads.",
    );
  }
  if (leads.some((lead) => lead.companyId !== ctx.companyId)) {
    throw new AppError("validation", "Every lead must belong to this company.");
  }
  const data = await store();
  const ids = new Set(data.leads.map((lead) => lead.id));
  const now = new Date();
  let added = 0;
  for (const lead of leads) {
    if (ids.has(lead.id)) continue;
    data.leads.push({ ...lead, assignedTo: null, sourceKind: "import" });
    appendEvent(data, ctx, lead, "imported", {}, now);
    ids.add(lead.id);
    added++;
  }
  return { added };
}

export async function applyStageChange(
  data: MockStore,
  ctx: Ctx,
  lead: Lead,
  stage: Stage,
  lostReasonId: string | null,
): Promise<{ lead: Lead }> {
  if (lead.stageId === stage.id && lead.lostReasonId === lostReasonId)
    return { lead };
  const from = lead.stageId;
  lead.stageId = stage.id;
  lead.lostReasonId = lostReasonId;
  if (stage.kind !== "open") lead.lostSuggestedAt = null;
  appendEvent(
    data,
    ctx,
    lead,
    "stage_changed",
    { from, to: stage.id, lostReasonId },
    new Date(),
  );
  return { lead };
}

export async function clearLostSuggestion(
  data: MockStore,
  ctx: Ctx,
  lead: Lead,
): Promise<{ ok: true }> {
  if (lead.lostSuggestedAt === null) return { ok: true };
  lead.lostSuggestedAt = null;
  appendEvent(data, ctx, lead, "lost_suggestion_dismissed", {}, new Date());
  return { ok: true };
}

function appendEvent(
  data: MockStore,
  ctx: Ctx,
  lead: Lead,
  type: LeadEventType,
  eventData: Record<string, unknown>,
  now: Date,
): void {
  data.events.push({
    id: randomUUID(),
    companyId: ctx.companyId,
    leadId: lead.id,
    type,
    actorMemberId: ctx.member?.id ?? null,
    actorUserId: ctx.user.id,
    data: eventData,
    createdAt: now,
  });
}
