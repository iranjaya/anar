import { describe, expect, it } from "vitest";
import { deactivateMemberSchema } from "../src/members.js";

const id = "10000000-0000-4000-8000-000000000001";

describe("member removal input", () => {
  it("accepts a destination, null, or no destination", () => {
    for (const input of [
      { memberId: id },
      { memberId: id, reassignTo: null },
      { memberId: id, reassignTo: id },
    ]) {
      expect(deactivateMemberSchema.safeParse(input).success).toBe(true);
    }
  });

  it("refuses an invalid destination", () => {
    expect(
      deactivateMemberSchema.safeParse({ memberId: id, reassignTo: "bad" })
        .success,
    ).toBe(false);
  });
});
