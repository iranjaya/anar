import { describe, expect, it } from "vitest";
import defaults from "../../src/modules/settings/defaults.js";

describe("settings defaults for a new company", () => {
  it("lists the eight stages in order, with one default and one ending of each kind", () => {
    expect(
      defaults.stageSeeds.map((seed) => [seed.name, seed.kind, seed.isDefault]),
    ).toEqual([
      ["New Lead", "open", true],
      ["Contacted", "open", false],
      ["Qualified", "open", false],
      ["Follow-up", "open", false],
      ["Site Visit", "open", false],
      ["Negotiation", "open", false],
      ["Booked", "won", false],
      ["Lost", "lost", false],
    ]);
  });

  it("counts only No Answer, Not Interested and Callback Requested as failed", () => {
    expect(defaults.outcomeSeeds).toHaveLength(10);
    expect(
      defaults.outcomeSeeds
        .filter((seed) => seed.countsAsFailed)
        .map((seed) => seed.name),
    ).toEqual(["Not Interested", "No Answer", "Callback Requested"]);
  });

  it("lists the seven lost reasons", () => {
    expect(defaults.reasonSeeds).toEqual([
      "Too Expensive",
      "Wrong Location",
      "Bought from Competitor",
      "Not Responding",
      "Not Genuine Lead",
      "Changed Mind",
      "Other",
    ]);
  });

  it("seeds the three scoring dropdowns with the import codes", () => {
    expect(
      defaults.fieldSeeds.map((seed) => [
        seed.key,
        seed.options.map((option) => option.value),
      ]),
    ).toEqual([
      [
        "purchase_timeline",
        [
          "<15 days",
          "15-30 days",
          "1-3 months",
          "3+ months",
          "within_1_month",
          "within_2_months",
          "within_3_months",
          "just_exploring",
        ],
      ],
      ["budget_fit", ["Yes", "Maybe"]],
      ["decision_maker", ["Yes", "Shared"]],
    ]);
    expect(defaults.fieldSeeds[0].options[0]).toEqual({
      value: "<15 days",
      label: "Under 15 days",
    });
  });

  it("keys a seed by its first name in lower case with underscores", () => {
    expect(defaults._seedKey("Connected - High Interest")).toBe(
      "connected_high_interest",
    );
    expect(defaults._seedKey("Follow-up")).toBe("follow_up");
  });
});
