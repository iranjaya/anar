import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDemoStore, setDemoFailure, store } from "@/mock/access";
import { resolveContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import { changeStage, dismissLostSuggestion } from "../server";

const now = new Date("2026-10-28T12:00:00+05:45");
const leadId = "sundar-lead-004";
const stageId = "sundar-heights-stage-7";
const lostReasonId = "sundar-heights-reason-0";

describe("lead updates", () => {
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

  it("requires a reason before moving a lead to Lost", async () => {
    const before = structuredClone(data);
    await expect(changeStage(ctx, { leadId, stageId })).rejects.toMatchObject({
      code: "validation",
      message: "Pick why it was lost.",
    });
    expect(data).toEqual(before);
  });

  it.each([
    { stageId: "pahad-view-stage-7", lostReasonId },
    { stageId, lostReasonId: "pahad-view-reason-0" },
  ])("rejects foreign stages and reasons without writing", async (change) => {
    const before = structuredClone(data);
    await expect(changeStage(ctx, { leadId, ...change })).rejects.toMatchObject(
      { code: "validation" },
    );
    expect(data).toEqual(before);
  });

  it.each(["sunaina", "prakash", "rohan"])(
    "lets %s mark an allowed lead as Lost with one event",
    async (userId) => {
      const actor = await resolveContext(
        {
          userId,
          actingCompanyId: userId === "rohan" ? "sundar-heights" : null,
        },
        "sundar-heights",
      );
      const eventCount = data.events.length;
      const result = await changeStage(actor, {
        leadId,
        stageId,
        lostReasonId,
      });
      expect(result.lead).toMatchObject({
        stageId,
        lostReasonId,
        lostSuggestedAt: null,
        failedAttempts: 5,
      });
      expect(data.leads.find((lead) => lead.id === leadId)).toEqual(
        result.lead,
      );
      expect(data.events).toHaveLength(eventCount + 1);
      expect(data.events.at(-1)).toMatchObject({
        companyId: "sundar-heights",
        leadId,
        type: "stage_changed",
        actorUserId: userId,
        actorMemberId: actor.member?.id ?? null,
        data: { from: "sundar-heights-stage-3", to: stageId, lostReasonId },
        createdAt: now,
      });
      await changeStage(actor, { leadId, stageId, lostReasonId });
      expect(data.events).toHaveLength(eventCount + 1);
    },
  );

  it("clears the lost reason when a lead is reopened", async () => {
    await changeStage(ctx, { leadId, stageId, lostReasonId });
    const result = await changeStage(ctx, {
      leadId,
      stageId: "sundar-heights-stage-3",
    });
    expect(result.lead).toMatchObject({
      stageId: "sundar-heights-stage-3",
      lostReasonId: null,
      lostSuggestedAt: null,
    });
  });

  it("hides another Admin's lead without writing", async () => {
    const before = structuredClone(data);
    await expect(
      changeStage(ctx, { leadId: "sundar-lead-011", stageId, lostReasonId }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(data).toEqual(before);
  });

  it("refuses an Admin dismissing the suggestion", async () => {
    const before = structuredClone(data);
    await expect(dismissLostSuggestion(ctx, leadId)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(data).toEqual(before);
  });

  it.each(["prakash", "rohan"])(
    "lets %s dismiss the suggestion with one event",
    async (userId) => {
      const actor = await resolveContext(
        {
          userId,
          actingCompanyId: userId === "rohan" ? "sundar-heights" : null,
        },
        "sundar-heights",
      );
      const eventCount = data.events.length;
      await expect(dismissLostSuggestion(actor, leadId)).resolves.toEqual({
        ok: true,
      });
      expect(data.leads.find((lead) => lead.id === leadId)).toMatchObject({
        lostSuggestedAt: null,
        failedAttempts: 5,
        stageId: "sundar-heights-stage-3",
      });
      expect(data.events).toHaveLength(eventCount + 1);
      expect(data.events.at(-1)).toMatchObject({
        leadId,
        type: "lost_suggestion_dismissed",
        actorUserId: userId,
        createdAt: now,
      });
      await dismissLostSuggestion(actor, leadId);
      expect(data.events).toHaveLength(eventCount + 1);
    },
  );

  it("rejects failed saves without changing the lead or timeline", async () => {
    const manager = await resolveContext(
      { userId: "prakash", actingCompanyId: null },
      "sundar-heights",
    );
    const before = structuredClone(data);
    await setDemoFailure(true);
    await expect(
      changeStage(ctx, { leadId, stageId, lostReasonId }),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(dismissLostSuggestion(manager, leadId)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(data).toEqual(before);
  });
});
