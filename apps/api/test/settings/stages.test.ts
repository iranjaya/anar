import { reorderStagesSchema, stageInputSchema } from "@anar/domain/settings";
import { describe, expect, it } from "vitest";

describe("stage input checks", () => {
  it("takes a trimmed name, a known type and a default flag", () => {
    expect(
      stageInputSchema.safeParse({
        name: " Visit ",
        kind: "open",
        isDefault: false,
      }),
    ).toMatchObject({ success: true, data: { name: "Visit" } });
    for (const input of [
      { name: "", kind: "open", isDefault: false },
      { name: "a".repeat(121), kind: "open", isDefault: false },
      { name: "Visit", kind: "closed", isDefault: false },
      { name: "Visit", kind: "open" },
      { id: "not-a-uuid", name: "Visit", kind: "open", isDefault: false },
      { name: "Visit", kind: "open", isDefault: false, position: 2 },
    ])
      expect(stageInputSchema.safeParse(input).success).toBe(false);
  });

  it("needs each stage once in a reorder", () => {
    const one = "01900000-0000-7000-8000-000000000001";
    const two = "01900000-0000-7000-8000-000000000002";
    expect(
      reorderStagesSchema.safeParse({ stageIds: [two, one] }).success,
    ).toBe(true);
    for (const stageIds of [[], [one, one], ["stage-1"]])
      expect(reorderStagesSchema.safeParse({ stageIds }).success).toBe(false);
  });
});
