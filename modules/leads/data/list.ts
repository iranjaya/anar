import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { loadSchema } from "@/modules/settings/server";
import { can, verifyContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import { bucketOf } from "../buckets";
import type { LeadRow, Priority } from "../types";

export async function listLeads(
  ctx: Ctx,
  filters: {
    assignedTo?: string;
    priority?: Priority;
    q?: string;
    cursor?: string;
  },
): Promise<{ items: LeadRow[]; nextCursor: string | null; total: number }> {
  const current = await verifyContext(ctx);
  const data = await store();
  const schema = await loadSchema(current);
  const company = data.companies.find(
    (company) => company.id === current.companyId,
  );
  if (!company) throw new AppError("not_found", "Company not found.");
  const assignedTo =
    current.role === "admin" ? current.member?.id : filters.assignedTo;
  const query = filters.q?.trim().toLowerCase();
  const leads = data.leads
    .filter(
      (lead) =>
        lead.companyId === current.companyId &&
        lead.deletedAt === null &&
        lead.mergedIntoId === null &&
        can(current, "leads.view", lead) &&
        (!assignedTo ||
          (assignedTo === "unassigned"
            ? lead.assignedTo === null
            : lead.assignedTo === assignedTo)) &&
        (!filters.priority || lead.priority === filters.priority) &&
        (!query ||
          lead.fullName?.toLowerCase().includes(query) ||
          lead.phoneE164?.includes(query)),
    )
    .sort(
      (a, b) =>
        b.leadDate.getTime() - a.leadDate.getTime() || a.id.localeCompare(b.id),
    );
  const start = filters.cursor
    ? leads.findIndex((lead) => lead.id === filters.cursor) + 1
    : 0;
  if (filters.cursor && start === 0)
    throw new AppError(
      "validation",
      "This page is no longer available. Start from the queue.",
    );
  const page = leads.slice(start, start + 50);
  const fields = schema.fields
    .filter((field) => field.type === "dropdown")
    .sort((a, b) => a.position - b.position);
  const now = new Date();
  const items = page.map((lead): LeadRow => {
    const stage = schema.stages.find((stage) => stage.id === lead.stageId);
    if (!stage)
      throw new AppError("unavailable", "Couldn't load this lead's stage.");
    const member = data.members.find(
      (member) =>
        member.companyId === current.companyId && member.id === lead.assignedTo,
    );
    const assignedAt =
      data.events
        .filter(
          (event) =>
            event.companyId === current.companyId &&
            event.leadId === lead.id &&
            event.type === "assigned" &&
            event.data.to === lead.assignedTo,
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
        ?.createdAt ?? null;
    return {
      id: lead.id,
      fullName: lead.fullName,
      phoneE164: lead.phoneE164,
      phoneValid: lead.phoneValid,
      priority: lead.priority,
      score: lead.score,
      nextActionAt: lead.nextActionAt,
      failedAttempts: lead.failedAttempts,
      source: lead.source,
      leadDate: lead.leadDate,
      stage: { id: stage.id, name: stage.name, kind: stage.kind },
      answers: fields.flatMap((field) => {
        const option = field.options?.find(
          (option) => option.value === lead.custom[field.key],
        );
        return option ? [{ key: field.key, label: option.label }] : [];
      }),
      assignedAt,
      assignee: member ? { memberId: member.id, name: member.name } : null,
      bucket: bucketOf(
        {
          ...lead,
          stageKind: stage.kind,
          assignedAt,
          followUpCount: data.followUps.filter(
            (call) =>
              call.companyId === current.companyId && call.leadId === lead.id,
          ).length,
        },
        now,
        company.timezone,
      ),
    };
  });
  return {
    items,
    total: leads.length,
    nextCursor:
      start + page.length < leads.length ? (page.at(-1)?.id ?? null) : null,
  };
}
