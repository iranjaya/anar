import type { ScoringConfig } from "@anar/domain/scoring";
import { describe, expect, it } from "vitest";
import { scoreLead } from "../../src/modules/scoring/index.js";

const config: ScoringConfig = {
  id: "01900000-0000-7000-8000-000000000001",
  companyId: "a1000000-0000-4000-8000-000000000001",
  version: 1,
  basePoints: 1,
  hotMin: 8,
  warmMin: 5,
  active: true,
  rules: [
    {
      fieldKey: "purchase_timeline",
      kind: "options",
      points: { "<15 days": 4, "15-30 days": 3, "3+ months": 0 },
    },
    { fieldKey: "budget_fit", kind: "options", points: { Yes: 3, Maybe: 2 } },
    {
      fieldKey: "budget_npr",
      kind: "range",
      ranges: [
        { min: null, max: 100, points: 0 },
        { min: 100, max: 200, points: 1 },
        { min: 200, max: null, points: 2 },
      ],
    },
  ],
};

describe("scoreLead", () => {
  it.each([
    [{ purchase_timeline: "15-30 days" }, 4, "cold"],
    [{ budget_fit: "Maybe", budget_npr: 250 }, 5, "warm"],
    [
      { purchase_timeline: "15-30 days", budget_fit: "Maybe", budget_npr: 150 },
      7,
      "warm",
    ],
    [{ purchase_timeline: "<15 days", budget_fit: "Yes" }, 8, "hot"],
  ])("scores %o as %i %s", (custom, score, priority) => {
    expect(scoreLead({ custom }, config)).toMatchObject({ score, priority });
  });

  it("gives only the base when values are missing, null or not listed", () => {
    const result = scoreLead(
      {
        custom: {
          budget_fit: null,
          purchase_timeline: "someday",
          other: "Yes",
        },
      },
      config,
    );
    expect(result).toEqual({
      score: 1,
      priority: "cold",
      breakdown: { base: 1 },
    });
  });

  it("matches the stored code, not the label", () => {
    const result = scoreLead(
      { custom: { purchase_timeline: "Under 15 days" } },
      config,
    );
    expect(result.breakdown).toEqual({ base: 1 });
  });

  it("keeps a matched rule that gives zero points", () => {
    const result = scoreLead(
      { custom: { purchase_timeline: "3+ months", budget_npr: 50 } },
      config,
    );
    expect(result.breakdown).toEqual({
      base: 1,
      purchase_timeline: 0,
      budget_npr: 0,
    });
  });

  it.each([
    [-1_000_000, 0],
    [99.99, 0],
    [100, 1],
    [199, 1],
    [200, 2],
    [1_000_000, 2],
  ])("puts %d in the range that starts at or below it", (value, points) => {
    expect(
      scoreLead({ custom: { budget_npr: value } }, config).breakdown.budget_npr,
    ).toBe(points);
  });

  it("does not read numbers from text", () => {
    const result = scoreLead({ custom: { budget_npr: "250" } }, config);
    expect(result.breakdown).toEqual({ base: 1 });
  });

  it("gives the same result for the same input and leaves the input alone", () => {
    const input = {
      custom: { purchase_timeline: "<15 days", budget_fit: "Yes" },
    };
    const copy = structuredClone(input);
    const first = scoreLead(input, config);
    expect(scoreLead(input, config)).toEqual(first);
    expect(input).toEqual(copy);
    expect(first.score).toBe(
      Object.values(first.breakdown).reduce((sum, p) => sum + p, 0),
    );
  });
});
