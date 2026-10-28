import "server-only";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { can } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import type { Lead } from "../types";

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
    data.events.push({
      id: randomUUID(),
      companyId: ctx.companyId,
      leadId: lead.id,
      type: "imported",
      actorMemberId: ctx.member?.id ?? null,
      actorUserId: ctx.user.id,
      data: {},
      createdAt: now,
    });
    ids.add(lead.id);
    added++;
  }
  return { added };
}
