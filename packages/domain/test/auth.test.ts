import { describe, expect, it } from "vitest";
import { requestOtpSchema, verifyOtpSchema } from "../src/auth.js";

describe("auth input", () => {
  it("normalizes email without changing provider-specific addresses", () => {
    expect(
      requestOtpSchema.parse({ email: " Sales.Name+Proof@Example.Test " }),
    ).toEqual({ email: "sales.name+proof@example.test" });
  });

  it("rejects identity and purpose fields supplied by the caller", () => {
    for (const extra of [
      { userId: "forged" },
      { platformRole: "owner" },
      { purpose: "step_up" },
      { sessionId: "forged" },
    ]) {
      expect(
        requestOtpSchema.safeParse({ email: "proof@example.test", ...extra })
          .success,
      ).toBe(false);
      expect(
        verifyOtpSchema.safeParse({
          email: "proof@example.test",
          code: "012345",
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it("keeps leading zeroes and refuses malformed codes", () => {
    expect(
      verifyOtpSchema.parse({ email: "proof@example.test", code: "000007" })
        .code,
    ).toBe("000007");
    for (const code of [
      7,
      "12345",
      "1234567",
      " 123456",
      "123456 ",
      "abcdef",
    ]) {
      expect(
        verifyOtpSchema.safeParse({ email: "proof@example.test", code })
          .success,
      ).toBe(false);
    }
  });
});
