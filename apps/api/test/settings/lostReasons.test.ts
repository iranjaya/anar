import {
  lostReasonIdSchema,
  lostReasonInputSchema,
} from "@anar/domain/settings";
import { describe, expect, it } from "vitest";

describe("lost reason input checks", () => {
  it("takes a trimmed name and nothing else", () => {
    expect(
      lostReasonInputSchema.safeParse({ name: " Too Far " }),
    ).toMatchObject({ success: true, data: { name: "Too Far" } });
    for (const input of [
      { name: "" },
      { name: "a".repeat(121) },
      { name: "Far", position: 1 },
    ])
      expect(lostReasonInputSchema.safeParse(input).success).toBe(false);
    expect(lostReasonIdSchema.safeParse({ lostReasonId: "far" }).success).toBe(
      false,
    );
  });
});
