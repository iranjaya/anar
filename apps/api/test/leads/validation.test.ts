import { AppError } from "@anar/domain/errors";
import { type Lead, updateLeadFieldsInputSchema } from "@anar/domain/leads";
import type { Field } from "@anar/domain/settings";
import { describe, expect, it } from "vitest";
import validation from "../../src/modules/leads/validation.js";

const leadId = "01900000-0000-7000-8000-000000000001";
const lead = {
  id: leadId,
  fullName: "Sita Sharma",
  phoneRaw: "9841000001",
  phoneE164: "+9779841000001",
  phoneValid: true,
  email: null,
  custom: { unit_type: "2bhk", budget: 50, note: "Old note", old: "kept" },
} as unknown as Lead;
const field = (
  key: string,
  type: Field["type"],
  extra: Partial<Field> = {},
): Field => ({
  id: leadId,
  companyId: leadId,
  key,
  label: key,
  type,
  options: null,
  isSystem: false,
  position: 1,
  archivedAt: null,
  ...extra,
});
const fields = [
  field("unit_type", "dropdown", {
    options: [
      { value: "2bhk", label: "2 BHK" },
      { value: "3bhk", label: "3 BHK" },
    ],
  }),
  field("budget", "number"),
  field("note", "text"),
  field("visit_on", "date"),
  field("source_id", "text", { isSystem: true }),
  field("old", "text", { archivedAt: new Date() }),
];
const patch = (input: object) => validation.patch(lead, input, fields, "NP");

describe("lead edit input", () => {
  it("needs at least one change", () => {
    expect(updateLeadFieldsInputSchema.safeParse({ leadId }).success).toBe(
      false,
    );
    expect(
      updateLeadFieldsInputSchema.safeParse({ leadId, custom: {} }).success,
    ).toBe(false);
  });

  it.each([
    ["a long name", { fullName: "a".repeat(201) }],
    ["a bad email", { email: "not-an-email" }],
    ["a long text answer", { custom: { note: "a".repeat(2001) } }],
    ["an endless number", { custom: { budget: Number.POSITIVE_INFINITY } }],
    ["a made-up key", { custom: { "Bad Key": "x" } }],
    ["an extra key", { score: 99 }],
  ])("refuses %s", (_name, change) => {
    expect(
      updateLeadFieldsInputSchema.safeParse({ leadId, ...change }).success,
    ).toBe(false);
  });
});

describe("lead edit patch", () => {
  it("leaves omitted values alone and clears with null", () => {
    const result = patch({ email: null, custom: { note: null } });
    expect(result.systemKeys).toEqual([]);
    expect(result.keys).toEqual(["note"]);
    expect(result.custom).toEqual({
      unit_type: "2bhk",
      budget: 50,
      note: null,
      old: "kept",
    });
  });

  it("treats a value equal to the stored one as no change", () => {
    const result = patch({
      fullName: "Sita Sharma",
      custom: { unit_type: "2bhk", budget: 50 },
    });
    expect(result).toEqual({ set: {}, custom: null, keys: [], systemKeys: [] });
  });

  it("stores a repaired phone raw and normalised", () => {
    const result = patch({ phoneRaw: "984-1000002" });
    expect(result.systemKeys).toEqual(["phoneRaw"]);
    expect(result.set).toEqual({
      phoneRaw: "984-1000002",
      phoneE164: "+9779841000002",
      phoneValid: true,
    });
  });

  it("keeps a phone that still does not parse as needing review", () => {
    expect(patch({ phoneRaw: "12" }).set).toEqual({
      phoneRaw: "12",
      phoneE164: null,
      phoneValid: false,
    });
  });

  it("accepts each field type's own values", () => {
    const result = patch({
      custom: {
        unit_type: "3bhk",
        budget: 75.5,
        note: "Calls after six",
        visit_on: "2026-11-02",
      },
    });
    expect(result.keys).toEqual(["unit_type", "budget", "note", "visit_on"]);
  });

  it.each([
    ["an unknown option", { unit_type: "4bhk" }],
    ["a number as text", { budget: "50" }],
    ["text as a number", { note: 5 }],
    ["a date with time", { visit_on: "2026-11-02T00:00:00Z" }],
    ["an impossible date", { visit_on: "2026-02-30" }],
    ["an unknown field", { nope: "x" }],
    ["a system field", { source_id: "x" }],
    ["an archived field", { old: "changed" }],
  ])("refuses %s", (_name, custom) => {
    expect(() => patch({ custom })).toThrow(AppError);
  });
});
