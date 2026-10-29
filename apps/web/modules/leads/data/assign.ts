import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { can, verifyContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";

export async function assignLeads(
  ctx: Ctx,
  input: { leadIds: string[]; memberId: string },
): Promise<{ updated: number }> {
  const current = await verifyContext(ctx);
  if (!can(current, "leads.assign"))
    throw new AppError("forbidden", "Only a manager can assign leads.");
  if (input.leadIds.length === 0 || input.leadIds.length > 500)
    throw new AppError("validation", "Select between 1 and 500 leads.");
  const data = await store();
  const member = data.members.find(
    (member) =>
      member.companyId === current.companyId &&
      member.id === input.memberId &&
      member.status === "active",
  );
  if (!member)
    throw new AppError("validation", "Pick an active member in this company.");
  const leads = data.leads.filter(
    (lead) =>
      lead.companyId === current.companyId &&
      input.leadIds.includes(lead.id) &&
      lead.deletedAt === null &&
      lead.mergedIntoId === null,
  );
  if (input.leadIds.some((id) => !leads.some((lead) => lead.id === id)))
    throw new AppError("not_found", "Lead not found.");
  const changed = leads.filter((lead) => lead.assignedTo !== member.id);
  const now = new Date();
  for (const lead of changed) {
    const from = lead.assignedTo;
    lead.assignedTo = member.id;
    data.events.push({
      id: randomUUID(),
      companyId: current.companyId,
      leadId: lead.id,
      type: "assigned",
      actorMemberId: current.member?.id ?? null,
      actorUserId: current.user.id,
      data: { from, to: member.id },
      createdAt: now,
    });
  }
  return { updated: changed.length };
}
