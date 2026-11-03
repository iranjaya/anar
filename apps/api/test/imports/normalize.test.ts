import type { HeaderColumn, Mapping } from "@anar/domain/imports";
import type { Field } from "@anar/domain/settings";
import { describe, expect, it } from "vitest";
import { normaliseRow } from "../../src/modules/imports/index.js";

const headers = [
  "full_name",
  "phone",
  "created_time",
  "platform",
  "campaign_name",
  "form_name",
  "email",
  "budget",
  "visit",
  "unit",
  "notes",
  "id",
];
const columns: HeaderColumn[] = headers.map((header, index) => ({
  index,
  original: header,
  header,
  normalized: header,
}));
const mapping: Mapping = [
  { header: "full_name", target: "system:full_name" },
  { header: "phone", target: "system:phone" },
  { header: "created_time", target: "system:lead_date" },
  { header: "platform", target: "system:source" },
  { header: "campaign_name", target: "system:campaign_name" },
  { header: "form_name", target: "system:form_name" },
  { header: "email", target: "system:email" },
  { header: "budget", target: "field:budget" },
  { header: "visit", target: "field:visit" },
  { header: "unit", target: "field:unit" },
  { header: "notes", target: "field:notes" },
  { header: "id", target: "skip" },
];
const field = (
  key: string,
  type: Field["type"],
  options: Field["options"] = null,
): Field => ({
  id: `00000000-0000-7000-8000-00000000000${key.length}`,
  companyId: "a1000000-0000-4000-8000-000000000001",
  key,
  label: key,
  type,
  options,
  isSystem: false,
  position: 10,
  archivedAt: null,
});
const fields = [
  field("budget", "number"),
  field("visit", "date"),
  field("unit", "dropdown", [{ value: "2_bhk", label: "2 BHK" }]),
  field("notes", "text"),
];
const importedAt = new Date("2026-10-01T00:00:00.000Z");
const run = (row: string[]) =>
  normaliseRow({
    row,
    columns,
    mapping,
    fields,
    defaultCountry: "NP",
    timezone: "Asia/Kathmandu",
    importedAt,
  });
const good = [
  " Test Lead ",
  "p:+9779841000001",
  "2026-09-12T10:11:12+05:45",
  "fb",
  "Spring",
  "Form A",
  "",
  "1500",
  "2026-09-20",
  "2_bhk",
  " call after 5 ",
  "l:1",
];

describe("row normalisation", () => {
  it.each([
    ["Asia/Kathmandu", "2026-11-01T20:00:00Z", "2026-11-02"],
    ["America/New_York", "2026-11-01T02:00:00Z", "2026-10-31"],
  ])(
    "keeps custom dates on the local day in %s",
    (timezone, value, expected) => {
      const row = [...good];
      row[8] = value;
      const result = normaliseRow({
        row,
        columns,
        mapping,
        fields,
        defaultCountry: "NP",
        timezone,
        importedAt,
      });
      expect(result.lead.custom.visit).toBe(expected);
    },
  );

  it("maps a clean row to a lead with no issues", () => {
    expect(run(good)).toEqual({
      lead: {
        fullName: "Test Lead",
        phoneRaw: "p:+9779841000001",
        phoneE164: "+9779841000001",
        phoneValid: true,
        email: null,
        source: "facebook",
        leadDate: new Date("2026-09-12T04:26:12.000Z"),
        campaignName: "Spring",
        formName: "Form A",
        externalId: null,
        custom: {
          budget: 1500,
          visit: "2026-09-20",
          unit: "2_bhk",
          notes: "call after 5",
        },
      },
      issues: [],
      newOptions: [],
      invalid: false,
    });
  });

  it("keeps a bad phone and flags it for review", () => {
    const row = run(good.with(1, "p:12345"));
    expect(row.lead).toMatchObject({
      phoneRaw: "p:12345",
      phoneE164: null,
      phoneValid: false,
    });
    expect(row.issues.map((i) => i.code)).toEqual(["invalid_phone"]);
    expect(row.invalid).toBe(false);
  });

  it.each<[string, string, string | null, string[]]>([
    ["ig", "ig", "instagram", []],
    ["Instagram", "Instagram", "instagram", []],
    ["empty", "", null, []],
    ["tiktok", "tiktok", "other", ["unknown_platform"]],
  ])("maps platform %s", (_, platform, source, codes) => {
    const row = run(good.with(3, platform));
    expect(row.lead.source).toBe(source);
    expect(row.issues.map((i) => i.code)).toEqual(codes);
  });

  it("uses the import time and flags a bad or missing date", () => {
    for (const value of ["soon", ""]) {
      const row = run(good.with(2, value));
      expect(row.lead.leadDate).toEqual(importedAt);
      expect(row.issues.map((i) => i.code)).toEqual(["bad_date"]);
    }
  });

  it("turns bad custom number and date into null with an issue", () => {
    const row = run(good.with(7, "lots").with(8, "next week"));
    expect(row.lead.custom).toMatchObject({ budget: null, visit: null });
    expect(row.issues.map((i) => i.code)).toEqual([
      "invalid_number",
      "invalid_custom_date",
    ]);
  });

  it("proposes a new dropdown answer without touching the field", () => {
    const row = run(good.with(9, "within_1_month"));
    expect(row.lead.custom.unit).toBe("within_1_month");
    expect(row.newOptions).toEqual([
      {
        fieldKey: "unit",
        option: { value: "within_1_month", label: "Within 1 month" },
      },
    ]);
    expect(fields[2].options).toEqual([{ value: "2_bhk", label: "2 BHK" }]);
  });

  it("stores null for empty custom values", () => {
    const row = run(good.with(7, "").with(8, " ").with(9, "").with(10, ""));
    expect(row.lead.custom).toEqual({
      budget: null,
      visit: null,
      unit: null,
      notes: null,
    });
    expect(row.issues).toEqual([]);
  });

  it("pads a short row and marks a row with extra cells invalid", () => {
    const short = run(good.slice(0, 3));
    expect(short.invalid).toBe(false);
    expect(short.lead.custom).toEqual({
      budget: null,
      visit: null,
      unit: null,
      notes: null,
    });
    const long = run([...good, "extra"]);
    expect(long.invalid).toBe(true);
    expect(long.issues.map((i) => i.code)).toEqual(["column_count"]);
    expect(run([...good, "", " "]).invalid).toBe(false);
  });

  it("refuses a column mapped to a field that does not exist", () => {
    expect(() =>
      normaliseRow({
        row: good,
        columns,
        mapping: [{ header: "notes", target: "field:missing" }],
        fields,
        defaultCountry: "NP",
        timezone: "Asia/Kathmandu",
        importedAt,
      }),
    ).toThrowError(expect.objectContaining({ code: "validation" }));
  });
});
