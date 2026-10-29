import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDemoStore, setDemoFailure, store } from "@/mock/access";
import { assignLeads } from "@/modules/leads/server";
import { resolveContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import { compareMembers, getMemberDashboard, getTeamOverview } from "../server";
import type { Range } from "../types";

const now = new Date("2026-10-28T12:00:00+05:45");
const today = {
  from: new Date("2026-10-28T00:00:00+05:45"),
  to: new Date("2026-10-28T23:59:59.999+05:45"),
};
const week = {
  from: new Date("2026-10-26T00:00:00+05:45"),
  to: new Date("2026-11-01T23:59:59.999+05:45"),
};
const sunaina = "sundar-heights-sunaina";
const aakash = "sundar-heights-aakash";

describe("dashboard reports", () => {
  let ctx: Ctx;
  let data: Awaited<ReturnType<typeof store>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    await resetDemoStore(now);
    ctx = await resolveContext(
      { userId: "prakash", actingCompanyId: null },
      "sundar-heights",
    );
    data = await store();
  });
  afterEach(async () => {
    await setDemoFailure(false);
    vi.useRealTimers();
  });

  it("keeps tile periods fixed when the table range changes", async () => {
    const daily = await getTeamOverview(ctx, today);
    const weekly = await getTeamOverview(ctx, week);
    expect(daily.tiles).toEqual({
      newToday: 49,
      unassigned: 45,
      overdue: 120,
      siteVisitsThisWeek: 20,
      bookingsThisMonth: 38,
      bookingsTarget: 10,
    });
    expect(weekly.tiles).toEqual(daily.tiles);
    expect(weekly.funnel.map(({ name, count }) => [name, count])).toEqual([
      ["New Lead", 100],
      ["Contacted", 48],
      ["Qualified", 55],
      ["Follow-up", 53],
      ["Site Visit", 47],
      ["Negotiation", 44],
      ["Booked", 38],
      ["Lost", 35],
    ]);
    expect(weekly.funnel.reduce((sum, stage) => sum + stage.count, 0)).toBe(
      420,
    );
    expect(weekly.bySource).toEqual([
      { source: "instagram", count: 105 },
      { source: "facebook", count: 315 },
    ]);
  });

  it("reads seeded member calls, targets, overdue and idle hot leads", async () => {
    const daily = await getTeamOverview(ctx, today);
    const weekly = await getTeamOverview(ctx, week);
    expect(
      daily.perMember.map((member) => [
        member.name,
        member.leadsHeld,
        member.calls,
        member.callsTarget,
        member.overdue,
        member.hotIdle2d,
      ]),
    ).toEqual([
      ["Sunaina Shrestha", 10, 3, 30, 3, 1],
      ["Aakash Pandey", 91, 28, 30, 15, 17],
      ["Rojina Lama", 91, 26, 30, 71, 15],
      ["Sujan Basnet", 92, 23, 30, 16, 18],
      ["Prerana Joshi", 91, 27, 30, 15, 20],
    ]);
    expect(
      weekly.perMember.map((member) => [member.calls, member.callsTarget]),
    ).toEqual([
      [9, 150],
      [28, 150],
      [53, 150],
      [23, 150],
      [53, 150],
    ]);
    for (const member of weekly.perMember)
      expect(member.hot + member.warm + member.cold).toBe(member.leadsHeld);
  });

  it("counts calls from Kathmandu midnight and Monday, including the last millisecond", async () => {
    const call = data.followUps[0];
    for (const [id, date] of [
      ["before-week", "2026-10-25T23:59:59.999+05:45"],
      ["start-week", "2026-10-26T00:00:00+05:45"],
      ["start-day", "2026-10-28T00:00:00+05:45"],
      ["end-day", "2026-10-28T23:59:59.999+05:45"],
      ["next-day", "2026-10-29T00:00:00+05:45"],
    ])
      data.followUps.push({ ...call, id, happenedAt: new Date(date) });
    const daily = await getTeamOverview(ctx, today);
    const weekly = await getTeamOverview(ctx, week);
    expect(
      daily.perMember.find((member) => member.memberId === sunaina)?.calls,
    ).toBe(5);
    expect(
      weekly.perMember.find((member) => member.memberId === sunaina)?.calls,
    ).toBe(13);
  });

  it("shows member buckets and actuals against each target period", async () => {
    const dashboard = await getMemberDashboard(ctx, {
      memberId: sunaina,
      ...week,
    });
    expect(dashboard).toEqual({
      counts: { overdue: 3, dueToday: 3, newLeads: 4 },
      targets: [
        { metric: "calls", period: "day", value: 30, actual: 3 },
        { metric: "calls", period: "week", value: 150, actual: 9 },
        { metric: "calls", period: "month", value: 600, actual: 16 },
        { metric: "site_visits", period: "week", value: 3, actual: 0 },
        { metric: "bookings", period: "month", value: 2, actual: 0 },
      ],
    });
    const custom = await getTeamOverview(ctx, { from: today.from, to: now });
    expect(
      custom.perMember.every((member) => member.callsTarget === null),
    ).toBe(true);
    data.targets = data.targets.filter((target) => target.memberId !== sunaina);
    expect(
      (await getMemberDashboard(ctx, { memberId: sunaina, ...week })).targets,
    ).toEqual([]);
  });

  it("counts a hot lead at 48 idle hours and excludes closed or recently contacted leads", async () => {
    const lead = data.leads[0];
    lead.lastContactedAt = new Date(now.getTime() - 48 * 3_600_000);
    expect((await getTeamOverview(ctx, today)).perMember[0].hotIdle2d).toBe(1);
    lead.lastContactedAt = new Date(lead.lastContactedAt.getTime() + 1);
    expect((await getTeamOverview(ctx, today)).perMember[0].hotIdle2d).toBe(0);
    lead.lastContactedAt = new Date(now.getTime() - 72 * 3_600_000);
    lead.stageId = "sundar-heights-stage-6";
    expect((await getTeamOverview(ctx, today)).perMember[0].hotIdle2d).toBe(0);
  });

  it("compares calls, first response median, visits, bookings and conversion", async () => {
    data.leads = data.leads.slice(0, 3);
    data.leads[2].assignedTo = aakash;
    const event = data.events[0];
    const at = (hours: number) =>
      new Date(today.from.getTime() + hours * 3_600_000);
    data.events = [
      {
        ...event,
        id: "assigned-a1",
        leadId: data.leads[0].id,
        type: "assigned",
        data: { to: sunaina },
        createdAt: at(0),
      },
      {
        ...event,
        id: "assigned-a2",
        leadId: data.leads[1].id,
        type: "assigned",
        data: { to: sunaina },
        createdAt: at(0),
      },
      {
        ...event,
        id: "assigned-b",
        leadId: data.leads[2].id,
        type: "assigned",
        data: { to: aakash },
        createdAt: at(0),
      },
      {
        ...event,
        id: "response-a1",
        leadId: data.leads[0].id,
        actorMemberId: sunaina,
        type: "follow_up_logged",
        createdAt: at(2),
      },
      {
        ...event,
        id: "response-a2",
        leadId: data.leads[1].id,
        actorMemberId: sunaina,
        type: "follow_up_logged",
        createdAt: at(4),
      },
      {
        ...event,
        id: "booking",
        leadId: data.leads[0].id,
        actorMemberId: sunaina,
        type: "stage_changed",
        data: { to: "sundar-heights-stage-6" },
        createdAt: at(5),
      },
    ];
    const call = data.followUps[0];
    data.followUps = [
      {
        ...call,
        id: "visit",
        leadId: data.leads[0].id,
        happenedAt: at(2),
        outcomeId: "sundar-heights-outcome-7",
      },
      { ...call, id: "call", leadId: data.leads[1].id, happenedAt: at(4) },
    ];
    expect(
      await compareMembers(ctx, { a: sunaina, b: aakash, ...today }),
    ).toEqual({
      a: {
        calls: 2,
        medianResponseHours: 3,
        siteVisits: 1,
        bookings: 1,
        conversion: 50,
      },
      b: {
        calls: 0,
        medianResponseHours: null,
        siteVisits: 0,
        bookings: 0,
        conversion: 0,
      },
    });
  });

  it("refuses the same person, foreign members and invalid ranges", async () => {
    await expect(
      compareMembers(ctx, { a: sunaina, b: sunaina, ...week }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      compareMembers(ctx, { a: sunaina, b: "pahad-view-dipen", ...week }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      getMemberDashboard(ctx, { memberId: "pahad-view-dipen", ...week }),
    ).rejects.toMatchObject({ code: "not_found" });
    for (const range of [
      { from: today.to, to: today.from },
      { from: new Date("invalid"), to: now },
    ] satisfies Range[]) {
      await expect(getTeamOverview(ctx, range)).rejects.toMatchObject({
        code: "validation",
      });
      await expect(
        getMemberDashboard(ctx, { memberId: sunaina, ...range }),
      ).rejects.toMatchObject({ code: "validation" });
      await expect(
        compareMembers(ctx, { a: sunaina, b: aakash, ...range }),
      ).rejects.toMatchObject({ code: "validation" });
    }
  });

  it("allows own member details and rejects forged Admin access to team reports", async () => {
    const admin = await resolveContext(
      { userId: "sunaina", actingCompanyId: null },
      ctx.companyId,
    );
    const forged = {
      ...admin,
      role: "super_admin" as const,
      member: ctx.member,
    };
    await expect(getTeamOverview(forged, week)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      compareMembers(forged, { a: sunaina, b: aakash, ...week }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      getMemberDashboard(admin, { memberId: aakash, ...week }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      getMemberDashboard(admin, { memberId: sunaina, ...week }),
    ).resolves.toMatchObject({
      counts: { overdue: 3, dueToday: 3, newLeads: 4 },
    });
    await expect(
      getTeamOverview({ ...ctx, companyId: "pahad-view" }, week),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("allows entered DNA and rejects access after leaving the company", async () => {
    const dna = await resolveContext(
      { userId: "rohan", actingCompanyId: ctx.companyId },
      ctx.companyId,
    );
    await expect(getTeamOverview(dna, week)).resolves.toMatchObject({
      tiles: { unassigned: 45 },
    });
    const left = { ...dna, session: { ...dna.session, actingCompanyId: null } };
    await expect(getTeamOverview(left, week)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      getMemberDashboard(left, { memberId: sunaina, ...week }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      compareMembers(left, { a: sunaina, b: aakash, ...week }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("updates the unassigned tile after assignment and omits deleted and merged leads", async () => {
    await assignLeads(ctx, {
      leadIds: ["sundar-lead-376", "sundar-lead-377", "sundar-lead-378"],
      memberId: sunaina,
    });
    expect((await getTeamOverview(ctx, week)).tiles.unassigned).toBe(42);
    data.leads[0].deletedAt = now;
    data.leads[1].mergedIntoId = data.leads[2].id;
    data.leads.push({
      ...data.leads[2],
      id: "foreign-lead",
      companyId: "pahad-view",
    });
    const report = await getTeamOverview(ctx, week);
    expect(report.funnel.reduce((sum, stage) => sum + stage.count, 0)).toBe(
      418,
    );
    expect(report.perMember[0].leadsHeld).toBe(11);
    expect(report.tiles.overdue).toBe(118);
  });

  it("returns empty Pahad reports and rejects outages instead of returning zeros", async () => {
    const pahad = await resolveContext(
      { userId: "mina", actingCompanyId: null },
      "pahad-view",
    );
    const report = await getTeamOverview(pahad, week);
    expect(report.tiles).toEqual({
      newToday: 0,
      unassigned: 0,
      overdue: 0,
      siteVisitsThisWeek: 0,
      bookingsThisMonth: 0,
      bookingsTarget: 4,
    });
    expect(report.perMember).toHaveLength(2);
    expect(
      report.perMember.every(
        (member) => member.leadsHeld === 0 && member.calls === 0,
      ),
    ).toBe(true);
    expect(report.funnel.every((stage) => stage.count === 0)).toBe(true);
    expect(report.bySource).toEqual([]);
    data.members = data.members.filter(
      (member) => member.companyId !== "pahad-view" || member.role !== "admin",
    );
    expect((await getTeamOverview(pahad, week)).perMember).toEqual([]);
    await setDemoFailure(true);
    await expect(getTeamOverview(ctx, week)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(
      getMemberDashboard(ctx, { memberId: sunaina, ...week }),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      compareMembers(ctx, { a: sunaina, b: aakash, ...week }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
