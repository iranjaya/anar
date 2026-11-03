import type { TenantTx } from "@anar/db/tenant";
import { describe, expect, it } from "vitest";
import summaries, {
  type SummaryDeps,
  type SummaryJob,
} from "../../src/modules/reports/summaries.js";

const agencyId = "20000000-0000-4000-8000-000000000001";
const companyId = "40000000-0000-4000-8000-000000000001";
const id = (n: number, prefix = "50000000") =>
  `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const job = (period: "daily" | "weekly", localDate: string): SummaryJob => ({
  agencyId,
  companyId,
  period,
  localDate,
});
const control = () => ({ signal: new AbortController().signal });

type Notice = Parameters<SummaryDeps["notify"]>[1];
type Member = { memberId: string; userId: string };
type Period = {
  at: Date;
  timezone: string;
  cursor: string | null;
  snapshot: Record<string, unknown>;
  done: boolean;
};
type State = {
  periods: Map<string, Period>;
  notices: Notice[];
};
type FakeTx = TenantTx & { state: State };
const stateOf = (tx: TenantTx) => (tx as FakeTx).state;

function harness() {
  let now = new Date("2026-11-02T02:15:00.000Z");
  let timezone = "Asia/Kathmandu";
  let weeklyInput: { from: Date; to: Date; at: Date } | null = null;
  let state: State = { periods: new Map(), notices: [] };
  let dailyAdmins: Member[] = [];
  let weeklyManagers: Member[] = [];
  let weekly = {
    leads: 0,
    calls: 0,
    siteVisits: 0,
    bookings: 0,
    overdue: 0,
    staffCalls: 0,
    byAdmin: [] as {
      memberId: string;
      userId: string;
      name: string;
      calls: number;
    }[],
  };
  const daily = new Map<
    string,
    { overdue: number; dueToday: number; newLeads: number }
  >();
  const removed = new Set<string>();
  let crashOn: string | null = null;
  const deps: SummaryDeps = {
    now: () => now,
    async withSystemTenant(_scope, fn) {
      const tx = { state: structuredClone(state) } as FakeTx;
      const result = await fn(tx);
      state = tx.state;
      return result;
    },
    readScopedCompanyTimezone: async () => timezone,
    readScopedCompanySlug: async () => "client-one",
    async openPeriod(tx, input) {
      const current = stateOf(tx);
      const key = `${input.kind}:${input.key}`;
      let period = current.periods.get(key);
      if (!period) {
        period = {
          at: input.at,
          timezone: input.timezone,
          cursor: null,
          snapshot: await input.snapshot(),
          done: false,
        };
        current.periods.set(key, period);
      }
      return period.done ? null : period;
    },
    async checkpoint(tx, input) {
      const period = stateOf(tx).periods.get(`${input.kind}:${input.key}`);
      if (!period) throw new Error("Period is missing");
      period.cursor = input.cursor;
      period.done = input.done;
    },
    async listDailyAdmins(_tx, input) {
      const rows = dailyAdmins
        .filter(
          (item) => !input.afterMemberId || item.memberId > input.afterMemberId,
        )
        .sort((left, right) => left.memberId.localeCompare(right.memberId));
      const items = rows.slice(0, input.limit);
      return {
        items,
        nextId:
          rows.length > input.limit ? (items.at(-1)?.memberId ?? null) : null,
      };
    },
    async listWeeklyManagers(_tx, input) {
      const rows = weeklyManagers
        .filter(
          (item) => !input.afterMemberId || item.memberId > input.afterMemberId,
        )
        .sort((left, right) => left.memberId.localeCompare(right.memberId));
      const items = rows.slice(0, input.limit);
      return {
        items,
        nextId:
          rows.length > input.limit ? (items.at(-1)?.memberId ?? null) : null,
      };
    },
    isActiveManager: async (_tx, userId) => !removed.has(userId),
    isActiveAdmin: async (_tx, userId) => !removed.has(userId),
    readDailyCounts: async (_tx, input) =>
      daily.get(input.memberId) ?? { overdue: 0, dueToday: 0, newLeads: 0 },
    readWeeklyCounts: async (_tx, input) => {
      weeklyInput = input;
      return weekly;
    },
    async hasNotification(tx, userId, dedupeKey) {
      return stateOf(tx).notices.some(
        (item) => item.userId === userId && item.dedupeKey === dedupeKey,
      );
    },
    canReceiveCompanyNotification: async (_tx, userId) => !removed.has(userId),
    async notify(tx, input) {
      stateOf(tx).notices.push(input);
      if (input.userId === crashOn) {
        crashOn = null;
        throw new Error("Notification store is down");
      }
      return { id: id(stateOf(tx).notices.length, "60000000") };
    },
  };
  return {
    run: summaries.create(deps).run,
    notices: () => state.notices,
    period: (kind: "daily" | "weekly", key: string) =>
      state.periods.get(`${kind}:${key}`),
    setNow: (value: string) => {
      now = new Date(value);
    },
    setTimezone: (value: string) => {
      timezone = value;
    },
    weeklyInput: () => weeklyInput,
    setDailyAdmins: (rows: Member[]) => {
      dailyAdmins = rows;
    },
    setDailyCounts: (
      memberId: string,
      counts: { overdue: number; dueToday: number; newLeads: number },
    ) => {
      daily.set(memberId, counts);
    },
    setWeeklyManagers: (rows: Member[]) => {
      weeklyManagers = rows;
    },
    setWeeklyCounts: (counts: typeof weekly) => {
      weekly = counts;
    },
    remove: (userId: string) => {
      removed.add(userId);
    },
    crashOn: (userId: string) => {
      crashOn = userId;
    },
  };
}

describe("summary jobs", () => {
  it("waits for local 08:00 and skips Admins with zero buckets", async () => {
    const run = harness();
    run.setDailyAdmins([
      { memberId: id(1), userId: id(1, "10000000") },
      { memberId: id(2), userId: id(2, "10000000") },
    ]);
    run.setDailyCounts(id(1), { overdue: 1, dueToday: 2, newLeads: 0 });
    run.setNow("2026-11-02T02:14:00.000Z");
    await run.run(job("daily", "2026-11-02"), control());
    expect(run.notices()).toEqual([]);
    expect(run.period("daily", "2026-11-02")).toBeUndefined();

    run.setNow("2026-11-02T02:15:00.000Z");
    await run.run(job("daily", "2026-11-02"), control());
    expect(run.notices()).toMatchObject([
      {
        userId: id(1, "10000000"),
        dedupeKey: `daily:${companyId}:2026-11-02`,
        url: "/client-one/today",
        data: {
          type: "daily",
          overdue: 1,
          dueToday: 2,
          newLeads: 0,
        },
      },
    ]);
    expect(run.period("daily", "2026-11-02")).toMatchObject({
      cursor: "1",
      done: true,
    });
    run.setDailyCounts(id(1), { overdue: 9, dueToday: 9, newLeads: 9 });
    await run.run(job("daily", "2026-11-02"), control());
    expect(run.notices()).toHaveLength(1);
    expect(run.notices()[0].data).toMatchObject({ overdue: 1 });
    expect(run.notices()[0].body).not.toContain("Delayed");
  });

  it("marks a daily summary delayed after the local five minute window", async () => {
    const run = harness();
    run.setNow("2026-11-02T02:20:00.000Z");
    run.setDailyAdmins([{ memberId: id(1), userId: id(1, "10000000") }]);
    run.setDailyCounts(id(1), { overdue: 1, dueToday: 0, newLeads: 0 });
    await run.run(job("daily", "2026-11-02"), control());
    expect(run.notices()[0].body).toContain("Delayed");
  });

  it("keeps daily counts when a later page fails", async () => {
    const run = harness();
    const admins = Array.from({ length: 105 }, (_, index) => ({
      memberId: id(index + 1),
      userId: id(index + 1, "10000000"),
    }));
    run.setDailyAdmins(admins);
    for (const admin of admins)
      run.setDailyCounts(admin.memberId, {
        overdue: 1,
        dueToday: 0,
        newLeads: 0,
      });
    run.crashOn(admins[102].userId);
    await expect(
      run.run(job("daily", "2026-11-02"), control()),
    ).rejects.toThrow("Notification store is down");
    expect(run.notices()).toHaveLength(100);
    expect(run.period("daily", "2026-11-02")).toMatchObject({
      cursor: "100",
      done: false,
    });
    for (const admin of admins)
      run.setDailyCounts(admin.memberId, {
        overdue: 0,
        dueToday: 0,
        newLeads: 0,
      });
    await run.run(job("daily", "2026-11-02"), control());
    expect(run.notices()).toHaveLength(105);
    expect(
      run
        .notices()
        .every((item) => item.data.type === "daily" && item.data.overdue === 1),
    ).toBe(true);
    expect(run.period("daily", "2026-11-02")).toMatchObject({
      cursor: "105",
      done: true,
    });
  });

  it("freezes weekly counts, staff calls and tied Admin ranks", async () => {
    const run = harness();
    run.setWeeklyManagers([
      { memberId: id(1), userId: id(1, "10000000") },
      { memberId: id(2), userId: id(2, "10000000") },
    ]);
    run.setWeeklyCounts({
      leads: 3,
      calls: 12,
      siteVisits: 2,
      bookings: 1,
      overdue: 4,
      staffCalls: 2,
      byAdmin: [
        { memberId: id(2), userId: id(2, "10000000"), name: "B", calls: 5 },
        { memberId: id(1), userId: id(1, "10000000"), name: "A", calls: 5 },
      ],
    });
    await run.run(job("weekly", "2026-10-26"), control());
    expect(run.notices()).toHaveLength(2);
    expect(run.notices()[0]).toMatchObject({
      dedupeKey: `weekly:${companyId}:2026-10-26`,
      url: "/client-one/notifications",
      data: {
        weekStart: "2026-10-26",
        calls: 12,
        staffCalls: 2,
        top: { name: "A", calls: 5, tied: true },
        bottom: { name: "B", calls: 5, tied: true },
      },
    });
    expect(run.notices()[0].body).toContain("staff calls");
    expect(run.notices()[0].body).toContain("tied");
  });

  it("keeps a weekly snapshot across a failed page and skips a removed manager", async () => {
    const run = harness();
    const managers = Array.from({ length: 105 }, (_, index) => ({
      memberId: id(index + 1),
      userId: id(index + 1, "10000000"),
    }));
    run.setWeeklyManagers(managers);
    run.setWeeklyCounts({
      leads: 1,
      calls: 7,
      siteVisits: 0,
      bookings: 0,
      overdue: 0,
      staffCalls: 0,
      byAdmin: [],
    });
    run.crashOn(managers[102].userId);
    await expect(
      run.run(job("weekly", "2026-10-26"), control()),
    ).rejects.toThrow("Notification store is down");
    expect(run.notices()).toHaveLength(100);
    expect(run.period("weekly", "2026-10-26")).toMatchObject({
      cursor: "100",
      done: false,
    });
    run.setWeeklyCounts({
      leads: 9,
      calls: 99,
      siteVisits: 9,
      bookings: 9,
      overdue: 9,
      staffCalls: 9,
      byAdmin: [],
    });
    run.remove(managers[103].userId);
    await run.run(job("weekly", "2026-10-26"), control());
    expect(run.notices()).toHaveLength(104);
    expect(new Set(run.notices().map((item) => item.userId)).size).toBe(104);
    expect(
      run
        .notices()
        .every((item) => item.data.type === "weekly" && item.data.calls === 7),
    ).toBe(true);
    expect(run.period("weekly", "2026-10-26")).toMatchObject({
      cursor: "105",
      done: true,
    });
  });

  it("uses this week's previous week on Tuesday and rejects an old week", async () => {
    const run = harness();
    run.setNow("2026-11-03T00:15:00.000Z");
    run.setWeeklyManagers([{ memberId: id(1), userId: id(1, "10000000") }]);
    await run.run(job("weekly", "2026-10-26"), control());
    expect(run.notices()).toHaveLength(1);
    expect(run.notices()[0].body).toContain("Delayed");
    await run.run(job("weekly", "2026-10-19"), control());
    expect(run.notices()).toHaveLength(1);
    expect(run.period("weekly", "2026-10-19")).toBeUndefined();
  });

  it("starts at local 08:00 after the DST change", async () => {
    const run = harness();
    run.setTimezone("America/New_York");
    run.setWeeklyManagers([{ memberId: id(1), userId: id(1, "10000000") }]);
    run.setNow("2026-11-02T12:59:00.000Z");
    await run.run(job("weekly", "2026-10-26"), control());
    expect(run.notices()).toHaveLength(0);
    run.setNow("2026-11-02T13:00:00.000Z");
    await run.run(job("weekly", "2026-10-26"), control());
    expect(run.notices()).toHaveLength(1);
    expect(run.weeklyInput()).toMatchObject({
      from: new Date("2026-10-26T04:00:00.000Z"),
      to: new Date("2026-11-02T05:00:00.000Z"),
    });
  });
});
