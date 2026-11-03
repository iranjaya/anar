import {
  createFieldSchema,
  createFieldsSchema,
  fieldKeyFromLabel,
  updateFieldSchema,
} from "@anar/domain/settings";
import { describe, expect, it } from "vitest";

const choices = [
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
];

describe("new field checks", () => {
  it("makes a key from the label, or asks for one when nothing usable is left", () => {
    expect(fieldKeyFromLabel("Apartment Type")).toBe("apartment_type");
    expect(fieldKeyFromLabel("  Budget (NPR)  ")).toBe("budget_npr");
    expect(fieldKeyFromLabel("Café")).toBe("cafe");
    expect(fieldKeyFromLabel("बजेट")).toBeNull();
    expect(fieldKeyFromLabel("2 BHK")).toBeNull();
    expect(fieldKeyFromLabel("Base")).toBeNull();
  });

  it("refuses bad and reserved keys", () => {
    for (const key of ["Budget", "1st", "has-dash", "base", "a".repeat(65)])
      expect(
        createFieldSchema.safeParse({ key, label: "Budget", type: "text" })
          .success,
      ).toBe(false);
    expect(
      createFieldSchema.safeParse({
        key: "a".repeat(64),
        label: "B",
        type: "text",
      }).success,
    ).toBe(true);
  });

  it("needs unique codes on a dropdown and no choices on other types", () => {
    const parse = (input: object) =>
      createFieldSchema.safeParse({ label: "Fit", ...input }).success;
    expect(parse({ type: "dropdown", options: choices })).toBe(true);
    expect(parse({ type: "dropdown", options: [] })).toBe(false);
    expect(
      parse({
        type: "dropdown",
        options: [...choices, { value: "Yes", label: "Sure" }],
      }),
    ).toBe(false);
    expect(
      parse({ type: "dropdown", options: [{ value: "", label: "Empty" }] }),
    ).toBe(false);
    expect(
      parse({
        type: "dropdown",
        options: Array.from({ length: 201 }, (_, index) => ({
          value: `c${index}`,
          label: `C ${index}`,
        })),
      }),
    ).toBe(false);
    expect(parse({ type: "text" })).toBe(true);
    expect(parse({ type: "number", options: choices })).toBe(false);
    expect(parse({ type: "date", label: " " })).toBe(false);
  });

  it("needs a key on every field in an import batch", () => {
    expect(
      createFieldsSchema.safeParse([
        { key: "fit", label: "Fit", type: "dropdown", options: choices },
        { key: "notes", label: "Notes", type: "text" },
      ]).success,
    ).toBe(true);
    expect(
      createFieldsSchema.safeParse([{ label: "Notes", type: "text" }]).success,
    ).toBe(false);
    expect(createFieldsSchema.safeParse([]).success).toBe(false);
  });

  it("needs at least one change in a field edit and never a new key", () => {
    const fieldId = "01900000-0000-7000-8000-000000000001";
    expect(updateFieldSchema.safeParse({ fieldId }).success).toBe(false);
    expect(updateFieldSchema.safeParse({ fieldId, label: "Fit" }).success).toBe(
      true,
    );
    expect(updateFieldSchema.safeParse({ fieldId, position: -1 }).success).toBe(
      false,
    );
    expect(
      updateFieldSchema.safeParse({ fieldId, key: "other", label: "Fit" })
        .success,
    ).toBe(false);
    expect(
      updateFieldSchema.safeParse({
        fieldId,
        definition: { type: "dropdown", options: choices },
      }).success,
    ).toBe(true);
  });
});
