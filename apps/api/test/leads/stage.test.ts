import { AppError } from "@anar/domain/errors";
import type { Stage } from "@anar/domain/settings";
import { describe, expect, it } from "vitest";
import stage from "../../src/modules/leads/stage.js";

const id = (n: number) => `01900000-0000-7000-8000-00000000000${n}`;
const make = (n: number, kind: Stage["kind"]): Stage => ({
  id: id(n),
  companyId: id(9),
  name: `Stage ${n}`,
  position: n,
  kind,
  isDefault: false,
});
const open = make(1, "open");
const next = make(2, "open");
const won = make(3, "won");
const lost = make(4, "lost");
const archived = make(5, "open");
const reason = { id: id(6), companyId: id(9), name: "Too far", position: 1 };
const otherReason = { ...reason, id: id(7), name: "Price" };
const schema = {
  stages: [open, next, won, lost],
  lostReasons: [reason, otherReason],
};
const plan = (
  from: Stage,
  move: { stageId: string; lostReasonId?: string | null },
  lostReasonId: string | null = null,
) => stage._plan({ stageId: from.id, lostReasonId }, from, schema, move);

describe("stage change rules", () => {
  it("does nothing when the stage and reason stay the same", () => {
    expect(plan(open, { stageId: open.id })).toBe(null);
    expect(
      plan(lost, { stageId: lost.id, lostReasonId: reason.id }, reason.id),
    ).toBe(null);
  });

  it("allows an archived current stage only as no change", () => {
    expect(plan(archived, { stageId: archived.id })).toBe(null);
    expect(() => plan(open, { stageId: archived.id })).toThrow(
      new AppError("validation", "Choose an active stage"),
    );
  });

  it("moves between open stages and records both kinds", () => {
    expect(plan(open, { stageId: next.id })).toEqual({
      set: { stageId: next.id, lostReasonId: null },
      data: {
        from: open.id,
        to: next.id,
        fromKind: "open",
        toKind: "open",
        lostReasonId: null,
      },
    });
  });

  it("clears the next action when a lead is won", () => {
    expect(plan(open, { stageId: won.id })?.set).toEqual({
      stageId: won.id,
      lostReasonId: null,
      nextActionAt: null,
    });
  });

  it("needs an active reason to mark a lead lost, and clears the suggestion", () => {
    expect(() => plan(open, { stageId: lost.id })).toThrow(
      new AppError("validation", "Choose why the lead was lost"),
    );
    expect(() => plan(open, { stageId: lost.id, lostReasonId: id(8) })).toThrow(
      AppError,
    );
    expect(
      plan(open, { stageId: lost.id, lostReasonId: reason.id })?.set,
    ).toEqual({
      stageId: lost.id,
      lostReasonId: reason.id,
      nextActionAt: null,
      lostSuggestedAt: null,
    });
  });

  it("refuses a reason for a stage that is not lost", () => {
    expect(() =>
      plan(open, { stageId: next.id, lostReasonId: reason.id }),
    ).toThrow(new AppError("validation", "Only a lost stage takes a reason"));
  });

  it("treats a new reason on the same lost stage as a change", () => {
    const result = plan(
      lost,
      { stageId: lost.id, lostReasonId: otherReason.id },
      reason.id,
    );
    expect(result?.data).toMatchObject({
      fromKind: "lost",
      toKind: "lost",
      lostReasonId: otherReason.id,
    });
  });

  it("starts a new pursuit only when a closed lead goes back to open", () => {
    expect(plan(lost, { stageId: open.id }, reason.id)?.set).toEqual({
      stageId: open.id,
      lostReasonId: null,
      failedAttempts: 0,
    });
    expect(plan(won, { stageId: next.id })?.set.failedAttempts).toBe(0);
    expect(
      plan(won, { stageId: lost.id, lostReasonId: reason.id })?.set,
    ).not.toHaveProperty("failedAttempts");
    expect(plan(lost, { stageId: won.id }, reason.id)?.set).not.toHaveProperty(
      "failedAttempts",
    );
  });
});
