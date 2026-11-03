import {
  companyMembers,
  leadEvents,
  leads,
  outcomes,
  stages,
} from "@anar/db/tenant";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readMemberDayCounts } from "../../src/modules/followups/index.js";
import buckets from "../../src/modules/leads/buckets.js";
import due from "../../src/modules/leads/due.js";
import today from "../../src/modules/leads/today.js";
import { loadSchema } from "../../src/modules/settings/index.js";
import { publicOrigin } from "../auth/fixture.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

type Lead = Partial<typeof leads.$inferInsert> & { assigned?: Date[] };
const hour = 3_600_000;

describe("Today puts each assigned open lead in one bucket", () => {
  let fixture: SettingsFixture;
  beforeAll(async () => {
    fixture = await startSettingsFixture();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  const service = () =>
    today.create({
      context: fixture.apps[0].tenant,
      loadSchema,
      readMemberDayCounts,
      now: () => fixture.now(),
    });
  async function setup() {
    const base = await fixture.setup();
    const login = async (role: "super_admin" | "admin") => {
      const user = await fixture.seedUser();
      const member = await fixture.seedMember(base.a, user.id, "active", role);
      const { cookie } = await fixture.loginAs(user);
      return { cookie, member, user };
    };
    const manager = await login("super_admin");
    const seller = await login("admin");
    const all = await fixture.scoped(base.a, (tx) => tx.select().from(stages));
    const open = all.find((stage) => stage.isDefault);
    const won = all.find((stage) => stage.kind === "won");
    if (!open || !won) throw new Error("Expected seeded stages");
    const now = fixture.now();
    const day = buckets.day(now, "Asia/Kathmandu");
    // Each lead is assigned to its member at the given times, oldest first.
    const add = async (memberId: string, rows: Lead[]) => {
      const ids = rows.map((row) => row.id ?? v7());
      await fixture.scoped(base.a, async (tx) => {
        await tx.insert(leads).values(
          rows.map(({ assigned, ...row }, n) => ({
            id: ids[n],
            companyId: base.a.companyId,
            phoneValid: false,
            sourceKind: "import" as const,
            leadDate: now,
            stageId: open.id,
            custom: {},
            score: 0,
            priority: "cold" as const,
            scoreBreakdown: {},
            scoredAt: now,
            assignedTo: memberId,
            ...row,
          })),
        );
        const events = rows.flatMap((row, n) =>
          (row.assigned ?? []).map((at, k) => ({
            id: v7(),
            companyId: base.a.companyId,
            leadId: ids[n],
            type: "assigned" as const,
            actorUserId: manager.user.id,
            data: {
              assignmentId: v7(),
              from: null,
              to:
                k === (row.assigned?.length ?? 0) - 1
                  ? (row.assignedTo ?? memberId)
                  : manager.member.id,
            },
            createdAt: at,
          })),
        );
        if (events.length > 0) await tx.insert(leadEvents).values(events);
      });
      return ids;
    };
    const as = async (who: { cookie: string }) =>
      service().requireContext({ headers: { cookie: who.cookie } }, base.slug);
    return { ...base, manager, seller, open, won, now, day, add, as };
  }
  const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

  it("shows saved calls and site visits in today's counts", async () => {
    const { a, seller, now, add, as } = await setup();
    const [leadId] = await add(seller.member.id, [{ nextActionAt: now }]);
    const [outcome] = await fixture.scoped(a, (tx) =>
      tx
        .select({ id: outcomes.id })
        .from(outcomes)
        .where(eq(outcomes.seedKey, "site_visit_done")),
    );
    const logged = await fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${a.company.slug}/followups/logFollowUp`,
      payload: { requestId: v7(), leadId, outcomeId: outcome.id },
      headers: { origin: publicOrigin, cookie: seller.cookie },
    });
    expect(logged.statusCode).toBe(200);
    expect((await service().getMyToday(await as(seller))).counts).toMatchObject(
      {
        callsToday: 1,
        siteVisitsToday: 1,
      },
    );
  });

  it("splits by next call and fresh assignment, at the exact edges", async () => {
    const { seller, manager, won, now, day, add, as } = await setup();
    const me = seller.member.id;
    const [
      overdue,
      dueNow,
      dueLate,
      newTomorrow,
      exactly24h,
      newCold,
      called,
      closed,
      deleted,
      reassignedBack,
    ] = await add(me, [
      { nextActionAt: ago(now, 60_000) },
      { nextActionAt: now, priority: "warm" },
      { nextActionAt: new Date(day.end.getTime() - 1), priority: "hot" },
      { nextActionAt: day.end, priority: "hot", assigned: [ago(now, hour)] },
      { assigned: [ago(now, 24 * hour)] },
      { assigned: [ago(now, 23 * hour)] },
      { assigned: [ago(now, hour)], lastContactedAt: ago(now, 30 * 60_000) },
      { nextActionAt: ago(now, hour), stageId: won.id },
      { nextActionAt: ago(now, hour), deletedAt: now },
      {
        priority: "warm",
        assigned: [
          ago(now, 30 * hour),
          ago(now, 20 * hour),
          ago(now, 2 * hour),
        ],
      },
    ]);
    await add(manager.member.id, [{ nextActionAt: ago(now, hour) }]);
    const result = await service().getMyToday(await as(seller));
    expect(ids(result.overdue)).toEqual([overdue]);
    expect(ids(result.dueToday)).toEqual([dueNow, dueLate]);
    expect(ids(result.newLeads)).toEqual([
      newTomorrow,
      reassignedBack,
      newCold,
    ]);
    expect(result.newLeads[0].assignedAt).toEqual(ago(now, hour));
    expect(result.counts).toEqual({
      overdue: 1,
      dueToday: 2,
      newLeads: 3,
      callsToday: 0,
      callsTarget: null,
      siteVisitsToday: 0,
      bookingsToday: 0,
      nextDueAt: day.end,
    });
    expect(result.hasAssignedLeads).toBe(true);
    const all = [...result.overdue, ...result.dueToday, ...result.newLeads];
    for (const missing of [exactly24h, called, closed, deleted])
      expect(ids(all)).not.toContain(missing);
  });

  it("orders by time, then hot, warm, cold, then ID", async () => {
    const { seller, now, add, as } = await setup();
    const at = ago(now, hour);
    const [cold, hot, warm] = await add(seller.member.id, [
      { nextActionAt: at, priority: "cold" },
      { nextActionAt: at, priority: "hot" },
      { nextActionAt: at, priority: "warm" },
    ]);
    const result = await service().getMyToday(await as(seller));
    expect(ids(result.overdue)).toEqual([hot, warm, cold]);
  });

  it("counts every row and pages past 50 with the first page's time", async () => {
    const { seller, now, add, as } = await setup();
    const rows = Array.from({ length: 55 }, (_, n) => ({
      nextActionAt: ago(now, (n + 1) * 60_000),
    }));
    await add(seller.member.id, rows);
    const actor = await as(seller);
    const first = await service().getMyToday(actor);
    expect(first.overdue).toHaveLength(50);
    expect(first.counts.overdue).toBe(55);
    const cursor = first.nextCursors.overdue;
    if (!cursor) throw new Error("Expected a second page");
    // Later rows would join the bucket if the second page used a new `now`.
    await add(seller.member.id, [
      { nextActionAt: new Date(now.getTime() + hour) },
    ]);
    fixture.advance(2 * hour);
    const second = await service().listTodayBucket(actor, {
      bucket: "overdue",
      cursor,
    });
    expect(second.items).toHaveLength(5);
    expect(second.total).toBe(55);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...ids(first.overdue), ...ids(second.items)]).size).toBe(
      55,
    );
    await expect(
      service().listTodayBucket(actor, { bucket: "new", cursor }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("tells nothing assigned apart from all caught up", async () => {
    const { seller, won, add, as } = await setup();
    const actor = await as(seller);
    expect((await service().getMyToday(actor)).hasAssignedLeads).toBe(false);
    await add(seller.member.id, [{ stageId: won.id }]);
    const caughtUp = await service().getMyToday(actor);
    expect(caughtUp).toMatchObject({
      hasAssignedLeads: true,
      overdue: [],
      dueToday: [],
      newLeads: [],
      counts: { nextDueAt: null },
    });
  });

  it("counts only today's moves into won by this member as bookings", async () => {
    const { a, seller, manager, open, won, now, day, add, as } = await setup();
    const [lead] = await add(seller.member.id, [{ stageId: won.id }]);
    const move = (
      memberId: string,
      at: Date,
      fromKind: "open" | "won" = "open",
    ) => ({
      id: v7(),
      companyId: a.companyId,
      leadId: lead,
      type: "stage_changed" as const,
      actorUserId: seller.user.id,
      actorMemberId: memberId,
      data: {
        from: open.id,
        to: won.id,
        fromKind,
        toKind: "won" as const,
        lostReasonId: null,
      },
      createdAt: at,
    });
    await fixture.scoped(a, (tx) =>
      tx
        .insert(leadEvents)
        .values([
          move(seller.member.id, now),
          move(seller.member.id, ago(day.start, 1)),
          move(seller.member.id, now, "won"),
          move(manager.member.id, now),
        ]),
    );
    expect(
      (await service().getMyToday(await as(seller))).counts.bookingsToday,
    ).toBe(1);
  });

  it("gives staff no Today, and lets only a manager read someone else's counts", async () => {
    const { a, seller, manager, now, add, as } = await setup();
    await add(seller.member.id, [{ nextActionAt: ago(now, hour) }]);
    const entered = await fixture.companyRequest(
      "POST",
      "enterCompany",
      a.cookie,
      { companyId: a.companyId, reason: "Checking the team's day" },
    );
    expect(entered.statusCode).toBe(200);
    const staff = await as(a);
    await expect(service().getMyToday(staff)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(
      await service().getBucketCounts(await as(manager), seller.member.id),
    ).toEqual({ overdue: 1, dueToday: 0, newLeads: 0 });
    expect(
      await service().getBucketCounts(await as(seller), seller.member.id),
    ).toEqual({ overdue: 1, dueToday: 0, newLeads: 0 });
    await expect(
      service().getBucketCounts(await as(seller), manager.member.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service().getBucketCounts(await as(manager), v7()),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("drops a deactivated member's leads and pages the overdue scan by lead", async () => {
    const { a, seller, manager, now, add } = await setup();
    await add(
      manager.member.id,
      Array.from({ length: 101 }, () => ({ nextActionAt: ago(now, hour) })),
    );
    await add(seller.member.id, [{ nextActionAt: ago(now, hour) }]);
    await fixture.scoped(a, (tx) =>
      tx
        .update(companyMembers)
        .set({ status: "deactivated", deactivatedAt: now })
        .where(eq(companyMembers.id, seller.member.id)),
    );
    const first = await fixture.scoped(a, (tx) =>
      due.listDueFollowUps(tx, { at: now, limit: 100 }),
    );
    expect(first.items).toHaveLength(100);
    expect(first.items[0]).toMatchObject({
      memberId: manager.member.id,
      userId: manager.user.id,
    });
    const second = await fixture.scoped(a, (tx) =>
      due.listDueFollowUps(tx, {
        at: now,
        afterLeadId: first.nextId ?? undefined,
        limit: 100,
      }),
    );
    expect(second).toMatchObject({ nextId: null });
    expect(second.items).toHaveLength(1);
    expect(
      await fixture.scoped(a, (tx) =>
        due.readDailyCounts(tx, {
          memberId: seller.member.id,
          at: now,
          timezone: "Asia/Kathmandu",
        }),
      ),
    ).toEqual({ overdue: 0, dueToday: 0, newLeads: 0 });
  });
});
