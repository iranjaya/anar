import { outcomeIdSchema, outcomeInputSchema } from "@anar/domain/settings";
import { describe, expect, it } from "vitest";

describe("call outcome input checks", () => {
  it("takes a trimmed name and a failed flag", () => {
    expect(
      outcomeInputSchema.safeParse({
        name: " Wrong Number ",
        countsAsFailed: true,
      }),
    ).toMatchObject({ success: true, data: { name: "Wrong Number" } });
    for (const input of [
      { name: "", countsAsFailed: false },
      { name: "Busy" },
      { name: "Busy", countsAsFailed: "yes" },
      { name: "Busy", countsAsFailed: false, position: 1 },
    ])
      expect(outcomeInputSchema.safeParse(input).success).toBe(false);
    expect(outcomeIdSchema.safeParse({ outcomeId: "busy" }).success).toBe(
      false,
    );
  });
});
