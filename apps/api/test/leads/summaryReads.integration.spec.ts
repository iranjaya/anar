import {
  companyMembers,
  followUps,
  leadEvents,
  outcomes,
  stages,
} from "@anar/db/tenant";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import summaryReads from "../../src/modules/leads/summaryReads.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

describe("weekly summary counts", () => {
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

  async function setup() {
    const base = await fixture.setup();
    const at = fixture.now();
    const from = new Date(at.getTime() - 7 * 86_400_000);
    const to = new Date(at.getTime() + 86_400_000);
    const catalog = await fixture.scoped(base.a, async (tx) => ({
      stages: await tx.select().from(stages),
      outcomes: await tx.select().from(outcomes),
    }));
    const stageId = (kind: "open" | "won" | "lost") => {
      const row = catalog.stages.find((row) => row.kind === kind);
      if (!row) throw new Error("Missing stage");
      return row.id;
    };
    const member = async (role: "admin" | "super_admin" = "admin") => {
      const user = await fixture.seedUser();
      return fixture.seedMember(base.a, user.id, "active", role);
    };
    const add = async (
      assignedTo: string | null,
      kind: "open" | "won" | "lost" = "open",
    ) => {
      const id = v7();
      await fixture.addLead(base.a, stageId(kind), {
        id,
        assignedTo,
        createdAt: at,
        nextActionAt: new Date(at.getTime() - 60_000),
      });
      return id;
    };
    const call = async (
      leadId: string,
      by: Awaited<ReturnType<typeof member>> | null,
      isSiteVisit = false,
      happenedAt = at,
    ) => {
      await fixture.scoped(base.a, (tx) =>
        tx.insert(followUps).values({
          id: v7(),
          companyId: base.a.companyId,
          leadId,
          byMemberId: by?.id ?? null,
          byUserId: by?.userId ?? base.a.user.id,
          outcomeId: catalog.outcomes[0].id,
          happenedAt,
          nextActionAt: null,
          stageBeforeId: stageId("open"),
          stageAfterId: stageId("open"),
          countsAsFailed: false,
          isSiteVisit,
          requestId: v7(),
          requestHash: "summary call",
          response: {},
        }),
      );
    };
    const read = () =>
      fixture.scoped(base.a, (tx) =>
        summaryReads.readWeeklyCounts(tx, { from, to, at }),
      );
    return {
      ...base,
      at,
      from,
      to,
      stageId,
      member,
      add,
      call,
      read,
      outcomeId: catalog.outcomes[0].id,
    };
  }

  it("keeps repeated reads stable after an outcome is renamed and its caller removed", async () => {
    const c = await setup();
    const admin = await c.member();
    const leadId = await c.add(null);
    await c.call(leadId, admin, true);
    await c.call(leadId, null);
    await c.call(leadId, admin, false, c.to);
    await fixture.scoped(c.a, async (tx) => {
      await tx
        .update(outcomes)
        .set({ name: "Renamed", archivedAt: c.at })
        .where(eq(outcomes.id, c.outcomeId));
      await tx
        .update(companyMembers)
        .set({ status: "deactivated", deactivatedAt: c.at })
        .where(eq(companyMembers.id, admin.id));
    });
    const first = await c.read();
    expect(first).toMatchObject({
      leads: 1,
      calls: 2,
      siteVisits: 1,
      staffCalls: 1,
      byAdmin: [],
    });
    expect(await c.read()).toEqual(first);
  });

  it("counts entry into won but skips another move within won", async () => {
    const c = await setup();
    const leadId = await c.add(null);
    await fixture.scoped(c.a, async (tx) => {
      for (const [fromKind, toKind, createdAt] of [
        ["open", "won", c.at],
        ["won", "won", c.at],
        ["won", "open", c.at],
        ["open", "won", c.at],
        ["open", "won", c.to],
      ] as const) {
        await tx.insert(leadEvents).values({
          id: v7(),
          companyId: c.a.companyId,
          leadId,
          type: "stage_changed",
          actorUserId: c.manager.user.id,
          createdAt,
          data: {
            from: c.stageId(fromKind),
            to: c.stageId(toKind),
            fromKind,
            toKind,
            lostReasonId: null,
          },
        });
      }
    });
    expect((await c.read()).bookings).toBe(2);
  });

  it("excludes inactive owners, closed stages and unassigned leads from overdue", async () => {
    const c = await setup();
    const active = await c.member();
    const inactive = await c.member();
    await c.add(active.id);
    await c.add(inactive.id);
    await c.add(active.id, "won");
    await c.add(active.id, "lost");
    await c.add(null);
    await fixture.scoped(c.a, (tx) =>
      tx
        .update(companyMembers)
        .set({ status: "deactivated", deactivatedAt: c.at })
        .where(eq(companyMembers.id, inactive.id)),
    );
    expect((await c.read()).overdue).toBe(1);
  });

  it("includes only active Admins with assigned work or calls", async () => {
    const c = await setup();
    const worker = await c.member();
    const caller = await c.member();
    await c.member();
    const manager = await c.member("super_admin");
    const leadId = await c.add(worker.id);
    await c.call(leadId, caller);
    await c.call(leadId, manager);
    const counts = await c.read();
    expect(counts.calls).toBe(2);
    expect(counts.byAdmin).toEqual(
      [
        {
          memberId: worker.id,
          userId: worker.userId,
          name: worker.name,
          calls: 0,
        },
        {
          memberId: caller.id,
          userId: caller.userId,
          name: caller.name,
          calls: 1,
        },
      ].sort((a, b) => a.memberId.localeCompare(b.memberId)),
    );
  });
});
