import type {
  CsvProfile,
  Mapping,
  MappingTemplate,
} from "@anar/domain/imports";
import type { Field } from "@anar/domain/settings";
import { describe, expect, it } from "vitest";
import mapping from "../../src/modules/imports/mapping.js";

function profile(
  headers: string[],
  kinds: Partial<Record<string, CsvProfile["columnKinds"][number]>> = {},
): CsvProfile {
  const columns = mapping.headerColumns(headers);
  return {
    encoding: "utf-8",
    delimiter: ",",
    columns,
    sample: [],
    rowCount: 1,
    dateRange: null,
    warning: null,
    columnKinds: columns.map(
      (c) => kinds[c.header] ?? { header: c.header, type: "text", options: [] },
    ),
  };
}
function template(
  headers: string[],
  rows: Mapping,
  overrides: Partial<MappingTemplate> = {},
): MappingTemplate {
  return {
    id: "01900000-0000-7000-8000-000000000001",
    companyId: "b0000000-0000-4000-8000-000000000001",
    name: "Spring form",
    headerFingerprint: mapping.fingerprint(mapping.headerColumns(headers)),
    headers,
    mapping: rows,
    formName: null,
    campaignName: null,
    createdBy: "c0000000-0000-4000-8000-000000000001",
    lastUsedAt: null,
    ...overrides,
  };
}
const field = (key: string): Field => ({
  id: `00000000-0000-7000-8000-0000000000${String(key.length).padStart(2, "0")}`,
  companyId: "b0000000-0000-4000-8000-000000000001",
  key,
  label: key,
  type: "text",
  options: null,
  isSystem: false,
  position: 10,
  archivedAt: null,
});
const match = (
  file: CsvProfile,
  templates: MappingTemplate[] = [],
  fields: Field[] = [],
) =>
  mapping.matchMapping({ profile: file, fields, templates, fileName: "x.csv" });

describe("column matching", () => {
  it("suggests system fields from synonyms and skips ad columns", () => {
    const result = match(
      profile([
        "Full Name",
        "Mobile",
        "E-mail",
        "created_time",
        "platform",
        "form_name",
        "campaign_name",
        "ad_id",
        "id",
      ]),
    );
    expect(result.suggestedMapping.map((row) => row.target)).toEqual([
      "system:full_name",
      "system:phone",
      "system:email",
      "system:lead_date",
      "system:source",
      "system:form_name",
      "system:campaign_name",
      "skip",
      "skip",
    ]);
    expect(result.matchedTemplate).toBeUndefined();
    expect(result.proposedFields).toEqual([]);
    expect(result.newColumns).toEqual([]);
    expect(result.missingColumns).toEqual([]);
  });

  it("maps to an active company field and proposes the rest with readable labels", () => {
    const file = profile(
      ["phone", "budget_fit", "when_are_you_planning_to_purchase?_"],
      {
        "when_are_you_planning_to_purchase?_": {
          header: "when_are_you_planning_to_purchase?_",
          type: "dropdown",
          options: [{ value: "within_1_month", label: "Within 1 month" }],
        },
      },
    );
    const result = match(file, [], [field("budget_fit")]);
    expect(result.suggestedMapping).toEqual([
      { header: "phone", target: "system:phone" },
      { header: "budget_fit", target: "field:budget_fit" },
      {
        header: "when_are_you_planning_to_purchase?_",
        target: "field:when_are_you_planning_to_purchase",
      },
    ]);
    expect(result.proposedFields).toEqual([
      {
        header: "when_are_you_planning_to_purchase?_",
        key: "when_are_you_planning_to_purchase",
        label: "When are you planning to purchase?",
        type: "dropdown",
        options: [{ value: "within_1_month", label: "Within 1 month" }],
      },
    ]);
  });

  it("gives a repeated header its own identity and Phone only once", () => {
    const result = match(profile(["phone", "Phone", "notes", "notes"]));
    expect(result.suggestedMapping).toEqual([
      { header: "phone", target: "system:phone" },
      { header: "Phone_2", target: "field:phone_2" },
      { header: "notes", target: "field:notes" },
      { header: "notes_2", target: "field:notes_2" },
    ]);
  });

  it("applies a saved template by header, even when columns move or lose an underscore", () => {
    const saved = template(
      ["phone", "when_?_", "unit"],
      [
        { header: "phone", target: "system:phone" },
        { header: "when_?_", target: "field:when" },
        { header: "unit", target: "field:unit" },
      ],
    );
    const result = match(profile(["unit", "phone", "when?"]), [saved]);
    expect(result.matchedTemplate).toEqual({
      id: saved.id,
      name: "Spring form",
    });
    expect(result.suggestedMapping).toEqual([
      { header: "unit", target: "field:unit" },
      { header: "phone", target: "system:phone" },
      { header: "when?", target: "field:when" },
    ]);
    expect(result.proposedFields).toEqual([]);
    expect(result.newColumns).toEqual([]);
    expect(result.missingColumns).toEqual([]);
  });

  it("does not guess a template for a file without one clear form name", () => {
    const saved = template(
      ["phone", "unit"],
      [
        { header: "phone", target: "system:phone" },
        { header: "unit", target: "field:unit" },
      ],
      { formName: "Spring" },
    );
    const result = match(profile(["phone", "unit", "budget"]), [saved]);
    expect(result.matchedTemplate).toBeUndefined();
    const twoForms = profile(["phone", "form_name", "unit"], {
      form_name: {
        header: "form_name",
        type: "dropdown",
        options: [
          { value: "Spring", label: "Spring" },
          { value: "Autumn", label: "Autumn" },
        ],
      },
    });
    expect(match(twoForms, [saved]).matchedTemplate).toBeUndefined();
  });

  it("uses the latest same-form template and lists new and missing columns", () => {
    const rows: Mapping = [
      { header: "phone", target: "system:phone" },
      { header: "form_name", target: "system:form_name" },
      { header: "unit", target: "field:unit" },
      { header: "when_?_", target: "field:when" },
    ];
    const older = template(["phone", "form_name", "unit", "when_?_"], rows, {
      id: "01900000-0000-7000-8000-000000000002",
      name: "Older",
      formName: "Spring",
      lastUsedAt: new Date("2026-09-01T00:00:00Z"),
    });
    const newer = {
      ...older,
      id: "01900000-0000-7000-8000-000000000003",
      name: "Newer",
      lastUsedAt: new Date("2026-10-01T00:00:00Z"),
    };
    const file = profile(
      ["phone", "form_name", "unit", "which_tower?", "budget"],
      {
        form_name: {
          header: "form_name",
          type: "dropdown",
          options: [{ value: "Spring", label: "Spring" }],
        },
      },
    );
    const result = match(file, [older, newer]);
    expect(result.matchedTemplate).toEqual({ id: newer.id, name: "Newer" });
    expect(result.suggestedMapping.slice(0, 3)).toEqual(rows.slice(0, 3));
    expect(result.newColumns).toEqual(["which_tower?", "budget"]);
    expect(result.missingColumns).toEqual(["when_?_"]);
    expect(result.proposedFields.map((f) => f.key)).toEqual([
      "which_tower",
      "budget",
    ]);
  });

  it("guesses answer labels from codes", () => {
    expect(
      ["within_1_month", "3_bhk", "not_sure_yet", "for_myself/family"].map(
        mapping.guessLabel,
      ),
    ).toEqual(["Within 1 month", "3 bhk", "Not sure yet", "For myself/family"]);
  });
});
