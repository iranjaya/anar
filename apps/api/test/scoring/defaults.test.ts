import { scoringConfigSchema } from "@anar/domain/scoring";
import type { CompanySchema, Field } from "@anar/domain/settings";
import { describe, expect, it } from "vitest";
import defaults from "../../src/modules/scoring/defaults.js";

const companyId = "a1000000-0000-4000-8000-000000000001";
const dropdown = (key: string, codes: string[]): Field => ({
  id: `f0000000-0000-4000-8000-00000000000${codes.length}`,
  companyId,
  key,
  label: key,
  type: "dropdown",
  options: codes.map((value) => ({ value, label: value })),
  isSystem: false,
  position: 0,
  archivedAt: null,
});
const timelineCodes = [
  "<15 days",
  "15-30 days",
  "1-3 months",
  "3+ months",
  "within_1_month",
  "within_2_months",
  "within_3_months",
  "just_exploring",
];
const schema = (fields: Field[]): CompanySchema => ({
  fields,
  stages: [],
  outcomes: [],
  lostReasons: [],
});
const seeded = [
  dropdown("purchase_timeline", timelineCodes),
  dropdown("budget_fit", ["Yes", "Maybe"]),
  dropdown("decision_maker", ["Yes", "Shared"]),
];

describe("scoring defaults", () => {
  it("gives the agreed points for each seeded code", () => {
    expect(defaults.rules).toEqual([
      {
        fieldKey: "purchase_timeline",
        kind: "options",
        points: {
          "<15 days": 4,
          "15-30 days": 3,
          "1-3 months": 2,
          "3+ months": 1,
          within_1_month: 4,
          within_2_months: 3,
          within_3_months: 2,
          just_exploring: 1,
        },
      },
      { fieldKey: "budget_fit", kind: "options", points: { Yes: 3, Maybe: 2 } },
      {
        fieldKey: "decision_maker",
        kind: "options",
        points: { Yes: 2, Shared: 1 },
      },
    ]);
  });

  it("has no apartment or purpose points", () => {
    const keys = defaults.rules.map((rule) => rule.fieldKey);
    expect(keys).not.toContain("apartment_type");
    expect(keys).not.toContain("purchase_purpose");
  });

  it("is a valid config", () => {
    expect(
      scoringConfigSchema.safeParse({
        id: "01900000-0000-7000-8000-000000000001",
        companyId,
        version: 1,
        basePoints: 1,
        hotMin: 8,
        warmMin: 5,
        rules: defaults.rules,
        active: true,
      }).success,
    ).toBe(true);
  });

  it("accepts the seeded fields, even with extra codes", () => {
    const extra = [...seeded];
    extra[1] = dropdown("budget_fit", ["Yes", "Maybe", "No"]);
    expect(() => defaults._requireFields(schema(extra))).not.toThrow();
  });

  it.each([
    ["a missing field", seeded.slice(1)],
    [
      "a field that is not a dropdown",
      [
        { ...seeded[0], type: "text" as const, options: null },
        ...seeded.slice(1),
      ],
    ],
    [
      "a missing code",
      [
        dropdown("purchase_timeline", timelineCodes.slice(1)),
        ...seeded.slice(1),
      ],
    ],
  ])("refuses %s", (_name, fields) => {
    expect(() => defaults._requireFields(schema(fields))).toThrow(
      expect.objectContaining({ code: "conflict" }),
    );
  });
});
