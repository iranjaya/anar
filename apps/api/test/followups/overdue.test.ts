import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import type { NotificationInput } from "@anar/domain/notifications";
import { describe, expect, it } from "vitest";
import overdue, {
  type OverdueScanDeps,
  type OverdueScanInput,
} from "../../src/modules/followups/overdue.js";
import type { DueFollowUp } from "../../src/modules/leads/due.js";

const companyId = "40000000-0000-4000-8000-000000000001";
const agencyId = "20000000-0000-4000-8000-000000000001";
const firstUser = "10000000-0000-4000-8000-000000000001";
const secondUser = "10000000-0000-4000-8000-000000000002";
const slot = "2026-11-02T00:00:00.000Z";
const job = (at = slot): OverdueScanInput => ({
  agencyId,
  companyId,
  slot: at,
});
const leadId = (n: number) =>
  `70000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

type Period = {
  at: Date;
  timezone: string;
  localDate: string;
  cursor: string | null;
  done: boolean;
};
type State = {
  leads: DueFollowUp[];
  periods: Map<string, Period>;
  notifications: NotificationInput[];
};
type FakeTx = TenantTx & { state: State };
const stateOf = (tx: TenantTx) => (tx as FakeTx).state;

function harness(count: number) {
  let now = new Date("2026-11-02T00:05:00.000Z");
  let state: State = {
    leads: Array.from({ length: count }, (_, index) => ({
      leadId: leadId(index + 1),
      memberId: "50000000-0000-4000-8000-000000000001",
      userId: firstUser,
      nextActionAt: new Date("2026-10-31T00:00:00.000Z"),
    })),
    periods: new Map(),
    notifications: [],
  };
  let failOn: string | null = null;
  let unavailable = false;
  const cursors: (string | undefined)[] = [];
  const scopes: unknown[] = [];
  const deps: OverdueScanDeps = {
    now: () => now,
    async withSystemTenant(scope, fn) {
      scopes.push(scope);
      if (unavailable)
        throw new AppError("not_found", "Company is unavailable");
      const tx = { state: structuredClone(state) } as FakeTx;
      const result = await fn(tx);
      state = tx.state;
      return result;
    },
    readScopedCompanyTimezone: async () => "Asia/Kathmandu",
    readScopedCompanySlug: async () => "client-one",
    async openPeriod(tx, input) {
      const current = stateOf(tx);
      let period = current.periods.get(input.slot);
      if (!period) {
        period = { ...input, cursor: null, done: false };
        current.periods.set(input.slot, period);
      }
      return period.done ? null : period;
    },
    async checkpointPeriod(tx, input) {
      const period = stateOf(tx).periods.get(input.slot);
      if (!period) throw new Error("Period is missing");
      period.cursor = input.cursor;
      period.done = input.done;
    },
    async listDueFollowUps(tx, input) {
      cursors.push(input.afterLeadId);
      const due = stateOf(tx)
        .leads.filter(
          (lead) =>
            lead.nextActionAt < input.at &&
            (!input.afterLeadId || lead.leadId > input.afterLeadId),
        )
        .sort((left, right) => left.leadId.localeCompare(right.leadId));
      const items = due.slice(0, input.limit);
      return {
        items,
        nextId:
          due.length > input.limit ? (items.at(-1)?.leadId ?? null) : null,
      };
    },
    async hasNotification(tx, userId, dedupeKey) {
      return stateOf(tx).notifications.some(
        (row) => row.userId === userId && row.dedupeKey === dedupeKey,
      );
    },
    canReceiveCompanyNotification: async () => true,
    async notify(tx, input) {
      stateOf(tx).notifications.push(input);
      if (input.data.type === "overdue" && input.data.leadId === failOn) {
        failOn = null;
        throw new Error("Notification store is down");
      }
      return { id: leadId(stateOf(tx).notifications.length) };
    },
  };
  return {
    scan: overdue.create(deps).scan,
    notifications: () => state.notifications,
    period: (key: string) => state.periods.get(key),
    cursors,
    scopes,
    failOn: (id: string) => {
      failOn = id;
    },
    setNow: (value: string) => {
      now = new Date(value);
    },
    reassign: (userId: string) => {
      state.leads[0].userId = userId;
    },
    suspend: () => {
      unavailable = true;
    },
  };
}

describe("overdue scan", () => {
  const control = () => ({ signal: new AbortController().signal });

  it("resumes after a failed page without sending twice or skipping a lead", async () => {
    const run = harness(205);
    run.failOn(leadId(135));
    await expect(run.scan(job(), control())).rejects.toThrow(
      "Notification store is down",
    );
    expect(run.notifications()).toHaveLength(100);
    expect(run.period(slot)).toMatchObject({
      cursor: leadId(100),
      done: false,
    });

    await run.scan(job(), control());
    expect(run.notifications()).toHaveLength(205);
    expect(new Set(run.notifications().map((row) => row.dedupeKey)).size).toBe(
      205,
    );
    expect(run.notifications().map((row) => row.data)).toEqual(
      Array.from({ length: 205 }, (_, index) => ({
        type: "overdue",
        leadId: leadId(index + 1),
        localDate: "2026-11-02",
      })),
    );
    expect(run.cursors).toEqual([
      undefined,
      leadId(100),
      leadId(100),
      leadId(200),
    ]);
    expect(run.period(slot)).toMatchObject({ cursor: leadId(205), done: true });
    expect(run.scopes).toContainEqual({
      agencyId,
      companyId,
      authority: "scheduler",
    });
  });

  it("keeps a same-day notice and notifies the new assignee", async () => {
    const run = harness(1);
    await run.scan(job(), control());
    const first = run.notifications()[0];
    run.setNow("2026-11-02T00:35:00.000Z");
    await run.scan(job("2026-11-02T00:30:00.000Z"), control());
    expect(run.notifications()).toEqual([first]);

    run.reassign(secondUser);
    run.setNow("2026-11-02T01:05:00.000Z");
    await run.scan(job("2026-11-02T01:00:00.000Z"), control());
    expect(run.notifications()).toHaveLength(2);
    expect(run.notifications()[0]).toEqual(first);
    expect(run.notifications().map((row) => row.userId)).toEqual([
      firstUser,
      secondUser,
    ]);
    expect(run.notifications()[1].dedupeKey).toBe(first.dedupeKey);
  });

  it("notifies a still-overdue lead on the next local day", async () => {
    const run = harness(1);
    run.setNow("2026-10-31T18:10:00.000Z");
    await run.scan(job("2026-10-31T18:00:00.000Z"), control());
    run.setNow("2026-10-31T18:40:00.000Z");
    await run.scan(job("2026-10-31T18:30:00.000Z"), control());
    expect(run.notifications().map((row) => row.dedupeKey)).toEqual([
      `overdue:${companyId}:${leadId(1)}:2026-10-31`,
      `overdue:${companyId}:${leadId(1)}:2026-11-01`,
    ]);
  });

  it("skips a suspended company and stops when cancelled", async () => {
    const run = harness(1);
    run.suspend();
    await expect(run.scan(job(), control())).resolves.toBeUndefined();
    expect(run.notifications()).toEqual([]);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      run.scan(job(), { signal: cancelled.signal }),
    ).rejects.toThrow();
  });

  it("rejects a slot outside a UTC half hour", async () => {
    const run = harness(1);
    await expect(
      run.scan(job("2026-11-02T00:15:00.000Z"), control()),
    ).rejects.toMatchObject({ code: "validation" });
  });
});
