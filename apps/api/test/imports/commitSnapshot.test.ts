import type { Mapping, NewField } from "@anar/domain/imports";
import { describe, expect, it } from "vitest";
import commitSnapshot from "../../src/modules/imports/commitSnapshot.js";

const mapping: Mapping = [
  { header: "phone", target: "system:phone" },
  { header: "unit", target: "field:unit" },
  { header: "timeline", target: "field:purchase_timeline" },
];
const unit: NewField = {
  header: "unit",
  key: "unit",
  label: "Unit",
  type: "dropdown",
  options: [{ value: "2_bhk", label: "2 BHK" }],
};
const found = [
  { fieldKey: "unit", option: { value: "3_bhk", label: "3 bhk" } },
  { fieldKey: "purchase_timeline", option: { value: "later", label: "Later" } },
  { fieldKey: "unit", option: { value: "4_bhk", label: "4 bhk" } },
];
const company = { defaultCountry: "NP", timezone: "Asia/Kathmandu" };

describe("commit snapshot", () => {
  it("gives a new dropdown the answers the file adds, and other fields an addition", () => {
    const plan = commitSnapshot.plan([unit], found);
    expect(plan).toEqual({
      newFields: [
        {
          key: "unit",
          label: "Unit",
          type: "dropdown",
          options: [
            { value: "2_bhk", label: "2 BHK" },
            { value: "3_bhk", label: "3 bhk" },
            { value: "4_bhk", label: "4 bhk" },
          ],
        },
      ],
      additions: [
        {
          fieldKey: "purchase_timeline",
          options: [{ value: "later", label: "Later" }],
        },
      ],
    });
    expect(commitSnapshot.changesSettings(plan)).toBe(true);
  });

  it("changes no settings when the file has no new field or answer", () => {
    const plan = commitSnapshot.plan([], []);
    expect(plan).toEqual({ newFields: [], additions: [] });
    expect(commitSnapshot.changesSettings(plan)).toBe(false);
  });

  it("keeps the same hash for the same choices and a new one for any change", () => {
    const input = {
      fileSha256: "a".repeat(64),
      mapping,
      plan: commitSnapshot.plan([unit], found),
      company,
    };
    const hash = commitSnapshot.hash(input);
    expect(commitSnapshot.hash(structuredClone(input))).toBe(hash);
    const changed = [
      { ...input, fileSha256: "b".repeat(64) },
      { ...input, mapping: mapping.slice(0, 2) },
      { ...input, plan: commitSnapshot.plan([unit], found.slice(0, 1)) },
      {
        ...input,
        plan: commitSnapshot.plan([{ ...unit, label: "Flat" }], found),
      },
      { ...input, company: { ...company, timezone: "UTC" } },
      { ...input, company: { ...company, defaultCountry: "IN" } },
    ];
    for (const other of changed)
      expect(commitSnapshot.hash(other)).not.toBe(hash);
  });
});
