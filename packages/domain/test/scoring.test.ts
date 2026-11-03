import { type ScoringConfig, scoringConfigSchema } from "@anar/domain/scoring";
import { describe, expect, it } from "vitest";

const config: ScoringConfig = {
  id: "01900000-0000-7000-8000-000000000001",
  companyId: "a1000000-0000-4000-8000-000000000001",
  version: 1,
  basePoints: 1,
  hotMin: 8,
  warmMin: 5,
  active: true,
  rules: [
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

describe("scoring config", () => {
  it("accepts option and range rules", () => {
    expect(scoringConfigSchema.parse(config)).toEqual(config);
  });

  it.each([
    ["version 0", { ...config, version: 0 }],
    ["warm at hot", { ...config, warmMin: 8 }],
    ["warm above hot", { ...config, warmMin: 9 }],
    ["negative base", { ...config, basePoints: -1 }],
    [
      "two rules for one field",
      { ...config, rules: [config.rules[0], config.rules[0]] },
    ],
    [
      "the reserved base key",
      { ...config, rules: [{ fieldKey: "base", kind: "options", points: {} }] },
    ],
    [
      "fraction points",
      {
        ...config,
        rules: [
          { fieldKey: "budget_fit", kind: "options", points: { Yes: 1.5 } },
        ],
      },
    ],
    [
      "negative points",
      {
        ...config,
        rules: [
          { fieldKey: "budget_fit", kind: "options", points: { Yes: -1 } },
        ],
      },
    ],
    [
      "min not below max",
      {
        ...config,
        rules: [
          {
            fieldKey: "budget_npr",
            kind: "range",
            ranges: [{ min: 5, max: 5, points: 1 }],
          },
        ],
      },
    ],
    [
      "overlapping ranges",
      {
        ...config,
        rules: [
          {
            fieldKey: "budget_npr",
            kind: "range",
            ranges: [
              { min: 0, max: 150, points: 1 },
              { min: 100, max: 200, points: 2 },
            ],
          },
        ],
      },
    ],
    [
      "two unbounded starts",
      {
        ...config,
        rules: [
          {
            fieldKey: "budget_npr",
            kind: "range",
            ranges: [
              { min: null, max: 10, points: 1 },
              { min: null, max: 20, points: 2 },
            ],
          },
        ],
      },
    ],
    [
      "an unknown rule kind",
      {
        ...config,
        rules: [{ fieldKey: "budget_fit", kind: "text", points: {} }],
      },
    ],
  ])("rejects %s", (_name, input) => {
    expect(scoringConfigSchema.safeParse(input).success).toBe(false);
  });
});
