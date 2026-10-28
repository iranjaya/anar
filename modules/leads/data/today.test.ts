import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDemoStore, setDemoFailure, store } from "@/mock/access";
import { resolveContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import { getBucketCounts, getMyToday } from "../server";

const now = new Date("2026-10-28T12:00:00+05:45");

describe("Today", () => {
  let ctx: Ctx;
  let data: Awaited<ReturnType<typeof store>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    await resetDemoStore(now);
    ctx = await resolveContext(
      { userId: "sunaina", actingCompanyId: null },
      "sundar-heights",
    );
    data = await store();
  });
  afterEach(async () => {
    await setDemoFailure(false);
    vi.useRealTimers();
  });

  it("gives Sunaina 3 overdue, 3 due today and 4 new leads", async () => {
    data.leads.push({
      ...data.leads[0],
      id: "foreign-company",
      companyId: "pahad-view",
    });
    const today = await getMyToday(ctx);
    expect(today.overdue).toHaveLength(3);
    expect(today.dueToday).toHaveLength(3);
    expect(today.newLeads).toHaveLength(4);
    const rows = [...today.overdue, ...today.dueToday, ...today.newLeads];
    expect(new Set(rows.map((lead) => lead.id))).toEqual(
      new Set(
        Array.from(
          { length: 10 },
          (_, index) => `sundar-lead-${String(index + 1).padStart(3, "0")}`,
        ),
      ),
    );
    expect(
      rows.every(
        (lead) => lead.assignee?.memberId === "sundar-heights-sunaina",
      ),
    ).toBe(true);
    expect(today.counts).toMatchObject({
      overdue: 3,
      dueToday: 3,
      newLeads: 4,
      callsToday: 3,
      callsTarget: 30,
      nextDueAt: new Date("2026-10-28T15:00:00+05:45"),
    });
  });

  it("uses option labels in form order", async () => {
    const { overdue } = await getMyToday(ctx);
    expect(overdue[0].answers).toEqual([
      { key: "purchase_timeline", label: "Within 1 month" },
      { key: "decision_maker", label: "Shared" },
      { key: "apartment_type", label: "3 BHK" },
      { key: "purchase_purpose", label: "For myself or family" },
    ]);
  });

  it("keeps a forged membership from changing whose leads are read", async () => {
    const other = data.members.find((member) => member.userId === "aakash");
    const today = await getMyToday({
      ...ctx,
      role: "super_admin",
      member: other ?? null,
    });
    expect(today.counts).toMatchObject({
      overdue: 3,
      dueToday: 3,
      newLeads: 4,
    });
    expect(
      today.overdue.every(
        (lead) => lead.assignee?.memberId === "sundar-heights-sunaina",
      ),
    ).toBe(true);
  });

  it("hides another company from an Admin", async () => {
    await expect(
      getMyToday({ ...ctx, companyId: "pahad-view" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses another Admin's counts", async () => {
    await expect(
      getBucketCounts(ctx, "sundar-heights-aakash"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      getBucketCounts(ctx, "sundar-heights-sunaina"),
    ).resolves.toEqual({ overdue: 3, dueToday: 3, newLeads: 4 });
  });

  it("lets a manager read company members but hides foreign members", async () => {
    const manager = await resolveContext(
      { userId: "prakash", actingCompanyId: null },
      "sundar-heights",
    );
    await expect(
      getBucketCounts(manager, "sundar-heights-sunaina"),
    ).resolves.toEqual({ overdue: 3, dueToday: 3, newLeads: 4 });
    await expect(
      getBucketCounts(manager, "pahad-view-dipen"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("returns a real empty state for a Pahad Admin", async () => {
    const pahad = await resolveContext(
      { userId: "dipen", actingCompanyId: null },
      "pahad-view",
    );
    await expect(getMyToday(pahad)).resolves.toMatchObject({
      hasAssignedLeads: false,
      overdue: [],
      dueToday: [],
      newLeads: [],
      counts: {
        overdue: 0,
        dueToday: 0,
        newLeads: 0,
        callsToday: 0,
        nextDueAt: null,
      },
    });
  });

  it("leaves deleted and merged leads out", async () => {
    data.leads[0].deletedAt = now;
    data.leads[1].mergedIntoId = data.leads[2].id;
    const today = await getMyToday(ctx);
    expect(today.overdue.map((lead) => lead.id)).toEqual(["sundar-lead-003"]);
    expect(today.counts.overdue).toBe(1);
  });

  it("keeps assigned leads distinct from empty when nothing is due today", async () => {
    for (const lead of data.leads) {
      if (lead.assignedTo === "sundar-heights-sunaina") {
        lead.nextActionAt = new Date("2026-10-29T10:00:00+05:45");
      }
    }
    const today = await getMyToday(ctx);
    expect(today.hasAssignedLeads).toBe(true);
    expect(today.overdue).toEqual([]);
    expect(today.dueToday).toEqual([]);
    expect(today.counts.nextDueAt).toEqual(
      new Date("2026-10-29T10:00:00+05:45"),
    );
  });

  it("counts calls from Kathmandu midnight and only for this member", async () => {
    const call = data.followUps[0];
    data.followUps.push(
      {
        ...call,
        id: "before-midnight",
        happenedAt: new Date("2026-10-27T18:14:59Z"),
      },
      {
        ...call,
        id: "at-midnight",
        happenedAt: new Date("2026-10-27T18:15:00Z"),
      },
      {
        ...call,
        id: "other-member",
        byMemberId: "sundar-heights-aakash",
        happenedAt: now,
      },
    );
    expect((await getMyToday(ctx)).counts.callsToday).toBe(4);
  });

  it("rejects failed loads instead of returning zero counts", async () => {
    await setDemoFailure(true);
    await expect(getMyToday(ctx)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(
      getBucketCounts(ctx, "sundar-heights-sunaina"),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
