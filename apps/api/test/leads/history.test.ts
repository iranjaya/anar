import type { TenantTx } from "@anar/db/tenant";
import { describe, expect, it } from "vitest";
import history, { type HistoryDeps } from "../../src/modules/leads/history.js";

const tx = {} as TenantTx;
const user = "01900000-0000-7000-8000-000000000001";
const member = "01900000-0000-7000-8000-000000000002";
const staff = "01900000-0000-7000-8000-000000000003";
const stageId = "01900000-0000-7000-8000-000000000004";
const reasonId = "01900000-0000-7000-8000-000000000005";
const empty = { fields: [], stages: [], outcomes: [], lostReasons: [] };

function deps() {
  const asked: Parameters<HistoryDeps["loadHistoricalReferences"]>[1][] = [];
  const read: string[][] = [];
  return {
    asked,
    read,
    deps: {
      loadHistoricalReferences: async (_tx, input) => {
        asked.push(input);
        return empty;
      },
      readProfiles: async (_tx, userIds) => {
        read.push(userIds);
        return userIds.map((id) => ({ id, name: `Name ${id.slice(-1)}` }));
      },
    } satisfies HistoryDeps,
  };
}

const imported = (actorUserId: string, actorMemberId: string | null) => ({
  type: "imported" as const,
  data: {},
  actorUserId,
  actorMemberId,
});

describe("lead history references", () => {
  it("asks for the lead's answers, score keys, stage and lost reason", async () => {
    const stub = deps();
    await history.references(
      stub.deps,
      tx,
      {
        custom: { unit_type: "2bhk", budget: null },
        scoreBreakdown: { base: 10, unit_type: 20, timeline: 5 },
        stageId,
        lostReasonId: reasonId,
      },
      [],
    );
    expect(stub.asked).toEqual([
      {
        fieldKeys: ["unit_type", "budget", "base", "timeline"],
        stageIds: [stageId],
        outcomeIds: [],
        lostReasonIds: [reasonId],
      },
    ]);
  });

  it("asks for nothing from settings for a timeline page", async () => {
    const stub = deps();
    await history.references(stub.deps, tx, null, []);
    expect(stub.asked).toEqual([
      { fieldKeys: [], stageIds: [], outcomeIds: [], lostReasonIds: [] },
    ]);
  });

  it("names each person once per member they acted as", async () => {
    const stub = deps();
    const refs = await history.references(stub.deps, tx, null, [
      imported(user, member),
      imported(user, member),
      imported(staff, null),
    ]);
    expect(stub.read).toEqual([[user, staff]]);
    expect(refs.actors).toEqual([
      { userId: user, memberId: member, name: "Name 1" },
      { userId: staff, memberId: null, name: "Name 3" },
    ]);
  });

  it("asks for the stages and reasons a stage change names, once each", async () => {
    const stub = deps();
    const otherStage = "01900000-0000-7000-8000-000000000006";
    await history.references(stub.deps, tx, null, [
      {
        ...imported(user, member),
        type: "stage_changed",
        data: { from: stageId, to: otherStage, lostReasonId: reasonId },
      },
      {
        ...imported(user, member),
        type: "stage_changed",
        data: { from: otherStage, to: stageId, lostReasonId: null },
      },
    ]);
    expect(stub.asked).toEqual([
      {
        fieldKeys: [],
        stageIds: [stageId, otherStage],
        outcomeIds: [],
        lostReasonIds: [reasonId],
      },
    ]);
  });
});
