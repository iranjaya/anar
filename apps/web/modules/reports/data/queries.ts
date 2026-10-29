import { differenceInHours } from "date-fns";
import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { getBucketCounts } from "@/modules/leads/server";
import { can, verifyContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import type { MemberDashboard, Metrics, Range, TeamOverview } from "../types";
import { readTargets, targetRange } from "./targets";

async function readReport(ctx: Ctx, range: Range, memberId?: string) {
  const current = await verifyContext(ctx);
  if (
    !can(current, "reports.view_all") &&
    (!memberId || current.member?.id !== memberId)
  )
    throw new AppError("forbidden", "You cannot view these reports.");
  if (
    !Number.isFinite(range.from.getTime()) ||
    !Number.isFinite(range.to.getTime()) ||
    range.from > range.to
  )
    throw new AppError("validation", "To must be on or after From.");
  const data = await store();
  const members = data.members.filter(
    (member) =>
      member.companyId === current.companyId && member.status === "active",
  );
  if (memberId && !members.some((member) => member.id === memberId))
    throw new AppError("not_found", "Member not found.");
  const timezone = data.companies.find(
    (company) => company.id === current.companyId,
  )?.timezone;
  if (!timezone) throw new AppError("not_found", "Company not found.");
  const leads = data.leads.filter(
    (lead) =>
      lead.companyId === current.companyId &&
      !lead.deletedAt &&
      !lead.mergedIntoId,
  );
  const ids = new Set(leads.map((lead) => lead.id));
  return {
    current,
    members,
    timezone,
    leads,
    calls: data.followUps.filter(
      (call) => call.companyId === current.companyId && ids.has(call.leadId),
    ),
    events: data.events.filter(
      (event) => event.companyId === current.companyId && ids.has(event.leadId),
    ),
    stages: data.stages
      .filter((stage) => stage.companyId === current.companyId)
      .sort((a, b) => a.position - b.position),
    outcomes: data.outcomes.filter(
      (outcome) => outcome.companyId === current.companyId,
    ),
  };
}

function within(date: Date, range: Range) {
  return date >= range.from && date <= range.to;
}

function activity(
  data: Awaited<ReturnType<typeof readReport>>,
  range: Range,
  memberId?: string,
) {
  const calls = data.calls.filter(
    (call) =>
      (!memberId || call.byMemberId === memberId) &&
      within(call.happenedAt, range),
  );
  return {
    calls: calls.length,
    siteVisits: calls.filter((call) =>
      data.outcomes.some(
        (outcome) =>
          outcome.id === call.outcomeId && outcome.name === "Site Visit Done",
      ),
    ).length,
    bookings: data.events.filter(
      (event) =>
        event.type === "stage_changed" &&
        (!memberId || event.actorMemberId === memberId) &&
        within(event.createdAt, range) &&
        data.stages.some(
          (stage) => stage.id === event.data.to && stage.kind === "won",
        ),
    ).length,
  };
}

export async function getTeamOverview(
  ctx: Ctx,
  range: Range,
): Promise<TeamOverview> {
  const data = await readReport(ctx, range);
  const now = new Date();
  const targets = await readTargets(data.current.companyId, now);
  const today = targetRange("day", now, data.timezone);
  const week = targetRange("week", now, data.timezone);
  const month = targetRange("month", now, data.timezone);
  const buckets = await Promise.all(
    data.members.map(async (member) => ({
      member,
      counts: await getBucketCounts(data.current, member.id),
    })),
  );
  const perMember = buckets
    .filter(({ member }) => member.role === "admin")
    .map(({ member, counts }) => {
      const held = data.leads.filter((lead) => lead.assignedTo === member.id);
      const callsTarget =
        targets.find(
          (target) =>
            target.memberId === member.id &&
            target.metric === "calls" &&
            targetRange(target.period, now, data.timezone).from.getTime() ===
              range.from.getTime() &&
            targetRange(target.period, now, data.timezone).to.getTime() ===
              range.to.getTime(),
        )?.value ?? null;
      return {
        memberId: member.id,
        name: member.name,
        leadsHeld: held.length,
        ...activity(data, range, member.id),
        callsTarget,
        overdue: counts.overdue,
        hot: held.filter((lead) => lead.priority === "hot").length,
        warm: held.filter((lead) => lead.priority === "warm").length,
        cold: held.filter((lead) => lead.priority === "cold").length,
        hotIdle2d: held.filter((lead) => {
          const assignedAt =
            data.events
              .filter(
                (event) =>
                  event.leadId === lead.id &&
                  event.type === "assigned" &&
                  event.data.to === member.id,
              )
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
              ?.createdAt ?? lead.createdAt;
          return (
            lead.priority === "hot" &&
            data.stages.some(
              (stage) => stage.id === lead.stageId && stage.kind === "open",
            ) &&
            differenceInHours(now, lead.lastContactedAt ?? assignedAt) >= 48
          );
        }).length,
      };
    });
  const bookingTargets = targets.filter(
    (target) =>
      target.metric === "bookings" &&
      target.period === "month" &&
      data.members.some(
        (member) => member.id === target.memberId && member.role === "admin",
      ),
  );
  return {
    tiles: {
      newToday: data.leads.filter((lead) => within(lead.createdAt, today))
        .length,
      unassigned: data.leads.filter((lead) => lead.assignedTo === null).length,
      overdue: buckets.reduce((sum, { counts }) => sum + counts.overdue, 0),
      siteVisitsThisWeek: activity(data, week).siteVisits,
      bookingsThisMonth: activity(data, month).bookings,
      bookingsTarget: bookingTargets.length
        ? bookingTargets.reduce((sum, target) => sum + target.value, 0)
        : null,
    },
    perMember,
    funnel: data.stages.map((stage) => ({
      stageId: stage.id,
      name: stage.name,
      kind: stage.kind,
      count: data.leads.filter((lead) => lead.stageId === stage.id).length,
    })),
    bySource: [...new Set(data.leads.map((lead) => lead.source))].map(
      (source) => ({
        source,
        count: data.leads.filter((lead) => lead.source === source).length,
      }),
    ),
  };
}

export async function getMemberDashboard(
  ctx: Ctx,
  input: Range & { memberId: string },
): Promise<MemberDashboard> {
  const data = await readReport(ctx, input, input.memberId);
  const now = new Date();
  const targets = await readTargets(data.current.companyId, now);
  return {
    counts: await getBucketCounts(data.current, input.memberId),
    targets: targets
      .filter((target) => target.memberId === input.memberId)
      .map((target) => {
        const actual = activity(
          data,
          targetRange(target.period, now, data.timezone),
          input.memberId,
        );
        const values = {
          calls: actual.calls,
          site_visits: actual.siteVisits,
          bookings: actual.bookings,
        };
        return {
          metric: target.metric,
          period: target.period,
          value: target.value,
          actual: values[target.metric],
        };
      }),
  };
}

export async function compareMembers(
  ctx: Ctx,
  input: Range & { a: string; b: string },
): Promise<{ a: Metrics; b: Metrics }> {
  const data = await readReport(ctx, input);
  if (!can(data.current, "reports.compare"))
    throw new AppError("forbidden", "You cannot compare this team.");
  if (input.a === input.b)
    throw new AppError("validation", "Pick two different people.");
  for (const id of [input.a, input.b]) {
    if (!data.members.some((member) => member.id === id))
      throw new AppError("validation", "Pick people from this company.");
  }
  function metrics(memberId: string): Metrics {
    const responses = data.events
      .filter(
        (event) => event.type === "assigned" && event.data.to === memberId,
      )
      .flatMap((assigned) => {
        const nextAssignment = data.events
          .filter(
            (event) =>
              event.leadId === assigned.leadId &&
              (event.type === "assigned" || event.type === "unassigned") &&
              event.createdAt > assigned.createdAt,
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
        const response = data.events
          .filter(
            (event) =>
              event.leadId === assigned.leadId &&
              event.type === "follow_up_logged" &&
              event.actorMemberId === memberId &&
              event.createdAt >= assigned.createdAt &&
              (!nextAssignment || event.createdAt < nextAssignment.createdAt),
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
        return response && within(response.createdAt, input)
          ? [
              (response.createdAt.getTime() - assigned.createdAt.getTime()) /
                3_600_000,
            ]
          : [];
      })
      .sort((a, b) => a - b);
    const middle = Math.floor(responses.length / 2);
    let medianResponseHours: number | null = null;
    if (responses.length)
      medianResponseHours =
        responses.length % 2
          ? responses[middle]
          : (responses[middle - 1] + responses[middle]) / 2;
    const values = activity(data, input, memberId);
    const held = data.leads.filter(
      (lead) => lead.assignedTo === memberId,
    ).length;
    return {
      ...values,
      medianResponseHours,
      conversion: held ? (values.bookings / held) * 100 : 0,
    };
  }
  return { a: metrics(input.a), b: metrics(input.b) };
}
