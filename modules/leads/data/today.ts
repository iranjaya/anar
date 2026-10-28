import { tz } from "@date-fns/tz";
import { isSameDay } from "date-fns";
import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { loadSchema } from "@/modules/settings/server";
import { can, verifyContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import { bucketOf } from "../buckets";
import type { LeadRow, TodayCounts } from "../types";

type TodayData = {
  hasAssignedLeads: boolean;
  overdue: LeadRow[];
  dueToday: LeadRow[];
  newLeads: LeadRow[];
  counts: TodayCounts;
};

export async function getMyToday(ctx: Ctx): Promise<TodayData> {
  const current = await verifyContext(ctx);
  if (!current.member || !can(current, "reports.view_own")) {
    throw new AppError(
      "forbidden",
      "You need a membership to view your leads.",
    );
  }
  return readToday(current, current.member.id);
}

export async function getBucketCounts(
  ctx: Ctx,
  memberId: string,
): Promise<Pick<TodayCounts, "overdue" | "dueToday" | "newLeads">> {
  const current = await verifyContext(ctx);
  if (!can(current, "reports.view_all") && current.member?.id !== memberId) {
    throw new AppError("forbidden", "You can only view your own lead counts.");
  }
  const { counts } = await readToday(current, memberId);
  return {
    overdue: counts.overdue,
    dueToday: counts.dueToday,
    newLeads: counts.newLeads,
  };
}

async function readToday(ctx: Ctx, memberId: string): Promise<TodayData> {
  const data = await store();
  const member = data.members.find(
    (member) =>
      member.companyId === ctx.companyId &&
      member.id === memberId &&
      member.status === "active",
  );
  const company = data.companies.find(
    (company) => company.id === ctx.companyId,
  );
  if (!member || !company) throw new AppError("not_found", "Member not found.");
  const schema = await loadSchema(ctx);
  const now = new Date();
  const local = { in: tz(company.timezone) };
  const leads = data.leads.filter(
    (lead) =>
      lead.companyId === ctx.companyId &&
      lead.assignedTo === memberId &&
      lead.deletedAt === null &&
      lead.mergedIntoId === null,
  );
  const calls = data.followUps.filter(
    (call) => call.companyId === ctx.companyId,
  );
  const assigned = new Map<string, Date>();
  for (const event of data.events) {
    if (
      event.companyId !== ctx.companyId ||
      event.type !== "assigned" ||
      event.data.to !== memberId
    )
      continue;
    const previous = assigned.get(event.leadId);
    if (!previous || event.createdAt > previous)
      assigned.set(event.leadId, event.createdAt);
  }
  const fields = schema.fields
    .filter((field) => field.type === "dropdown")
    .sort((a, b) => a.position - b.position);
  const rows: LeadRow[] = [];
  let nextDueAt: Date | null = null;
  for (const lead of leads) {
    const stage = schema.stages.find((stage) => stage.id === lead.stageId);
    if (!stage)
      throw new AppError("unavailable", "Couldn't load this lead's stage.");
    const assignedAt = assigned.get(lead.id) ?? null;
    const bucket = bucketOf(
      {
        ...lead,
        stageKind: stage.kind,
        assignedAt,
        followUpCount: calls.filter((call) => call.leadId === lead.id).length,
      },
      now,
      company.timezone,
    );
    if (
      stage.kind === "open" &&
      lead.nextActionAt &&
      lead.nextActionAt > now &&
      (!nextDueAt || lead.nextActionAt < nextDueAt)
    )
      nextDueAt = lead.nextActionAt;
    if (bucket === null) continue;
    rows.push({
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
      assignee: { memberId, name: member.name },
      bucket,
    });
  }
  const overdue = rows.filter((row) => row.bucket === "overdue");
  const dueToday = rows.filter((row) => row.bucket === "due_today");
  const newLeads = rows.filter((row) => row.bucket === "new");
  const todayCalls = calls.filter(
    (call) =>
      call.byMemberId === memberId && isSameDay(call.happenedAt, now, local),
  );
  const target = data.targets.find(
    (target) =>
      target.companyId === ctx.companyId &&
      target.memberId === memberId &&
      target.metric === "calls" &&
      target.period === "day" &&
      target.startsOn <= now &&
      (target.endsOn === null || target.endsOn >= now),
  );
  return {
    hasAssignedLeads: leads.length > 0,
    overdue,
    dueToday,
    newLeads,
    counts: {
      overdue: overdue.length,
      dueToday: dueToday.length,
      newLeads: newLeads.length,
      callsToday: todayCalls.length,
      callsTarget: target?.value ?? null,
      siteVisitsToday: todayCalls.filter((call) =>
        schema.outcomes.some(
          (outcome) =>
            outcome.id === call.outcomeId && outcome.name === "Site Visit Done",
        ),
      ).length,
      bookingsToday: data.events.filter(
        (event) =>
          event.companyId === ctx.companyId &&
          event.actorMemberId === memberId &&
          event.type === "stage_changed" &&
          isSameDay(event.createdAt, now, local) &&
          schema.stages.some(
            (stage) => stage.id === event.data.to && stage.kind === "won",
          ),
      ).length,
      nextDueAt,
    },
  };
}
