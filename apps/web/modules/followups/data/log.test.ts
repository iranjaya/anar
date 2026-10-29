import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDemoStore, setDemoFailure, store } from "@/mock/access";
import { resolveContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import { logFollowUp } from "../server";

const now = new Date("2026-10-28T12:00:00+05:45");
const leadId = "sundar-lead-001";
const outcomeId = "sundar-heights-outcome-3";
const stageId = "sundar-heights-stage-7";
const lostReasonId = "sundar-heights-reason-0";
const nextActionAt = new Date("2026-10-29T10:00:00+05:45");

describe("call logging", () => {
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

  it.each(["sunaina", "prakash"])(
    "saves a call and its next date for %s",
    async (userId) => {
      const actor = await resolveContext(
        { userId, actingCompanyId: null },
        "sundar-heights",
      );
      const before = structuredClone(
        data.leads.find((lead) => lead.id === leadId),
      );
      const calls = data.followUps.length;
      const events = data.events.length;
      const result = await logFollowUp(actor, {
        leadId,
        outcomeId,
        notes: "  Call tomorrow morning.  ",
        nextActionAt,
      });
      expect(result.lead).toMatchObject({
        lastContactedAt: now,
        nextActionAt,
        stageId: before?.stageId,
        failedAttempts: before?.failedAttempts,
      });
      expect(result.followUp).toEqual({
        id: expect.any(String),
        companyId: ctx.companyId,
        leadId,
        byMemberId: actor.member?.id,
        outcomeId,
        notes: "Call tomorrow morning.",
        happenedAt: now,
        nextActionAt,
        stageBeforeId: before?.stageId,
        stageAfterId: before?.stageId,
      });
      expect(data.followUps).toHaveLength(calls + 1);
      expect(data.followUps.at(-1)).toEqual(result.followUp);
      expect(data.leads.find((lead) => lead.id === leadId)).toEqual(
        result.lead,
      );
      expect(data.events).toHaveLength(events + 1);
      expect(data.events.at(-1)).toMatchObject({
        companyId: ctx.companyId,
        leadId,
        type: "follow_up_logged",
        actorUserId: userId,
        actorMemberId: actor.member?.id,
        data: { followUpId: result.followUp.id },
        createdAt: now,
      });
      expect(result.lostSuggested).toBe(false);
    },
  );

  it.each([
    { stageId },
    { stageId, lostReasonId: "pahad-view-reason-0" },
    { stageId: "pahad-view-stage-7", lostReasonId },
    { outcomeId: "pahad-view-outcome-3" },
    { outcomeId: "" },
    { nextActionAt: new Date("invalid") },
  ])("rejects invalid call details without writing", async (change) => {
    const before = structuredClone(data);
    await expect(
      logFollowUp(ctx, { leadId, outcomeId, ...change }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(data).toEqual(before);
  });

  it.each(["sundar-lead-011", "pahad-lead-001"])(
    "hides a foreign lead without writing: %s",
    async (foreignId) => {
      const before = structuredClone(data);
      await expect(
        logFollowUp(ctx, { leadId: foreignId, outcomeId }),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(data).toEqual(before);
    },
  );

  it("refuses DNA without writing", async () => {
    const dna = await resolveContext(
      { userId: "rohan", actingCompanyId: "sundar-heights" },
      "sundar-heights",
    );
    const before = structuredClone(data);
    await expect(logFollowUp(dna, { leadId, outcomeId })).rejects.toMatchObject(
      {
        code: "forbidden",
      },
    );
    expect(data).toEqual(before);
  });

  it("logs Lost with its reason and clears the next date", async () => {
    const result = await logFollowUp(ctx, {
      leadId,
      outcomeId,
      stageId,
      lostReasonId,
      notes: "Hidden note",
      nextActionAt,
    });
    expect(result.lead).toMatchObject({
      stageId,
      lostReasonId,
      lastContactedAt: now,
      nextActionAt: null,
      lostSuggestedAt: null,
    });
    expect(result.followUp).toMatchObject({
      stageBeforeId: "sundar-heights-stage-3",
      stageAfterId: stageId,
      notes: null,
      nextActionAt: null,
    });
    expect(data.events.slice(-2).map((event) => event.type)).toEqual([
      "stage_changed",
      "follow_up_logged",
    ]);
    expect(data.events.at(-2)?.data).toEqual({
      from: "sundar-heights-stage-3",
      to: stageId,
      lostReasonId,
    });
  });

  it("keeps all data when the demo fails", async () => {
    const before = structuredClone(data);
    await setDemoFailure(true);
    await expect(logFollowUp(ctx, { leadId, outcomeId })).rejects.toMatchObject(
      {
        code: "unavailable",
      },
    );
    expect(data).toEqual(before);
  });
});
