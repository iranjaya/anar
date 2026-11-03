import { describe, expect, it } from "vitest";
import phone from "../../src/lib/phone.js";

describe("phone normalisation", () => {
  it.each([
    ["p:+9779841234567", "+9779841234567"],
    ["009779841234567", "+9779841234567"],
    ["984-123 4567", "+9779841234567"],
    ["(984) 123.4567", "+9779841234567"],
    ["p:+919812345678", "+919812345678"],
    ["+971 50 123 4567", "+971501234567"],
  ])("turns %j into %s", (raw, e164) => {
    expect(phone.normalisePhone(raw, "NP")).toEqual({
      phoneRaw: raw,
      phoneE164: e164,
      phoneValid: true,
    });
  });

  it("keeps a bad phone as it came and flags it", () => {
    expect(phone.normalisePhone("p:12345", "NP")).toEqual({
      phoneRaw: "p:12345",
      phoneE164: null,
      phoneValid: false,
    });
  });

  it.each([null, "", "   "])("gives no phone for %j", (raw) => {
    expect(phone.normalisePhone(raw, "NP")).toEqual({
      phoneRaw: null,
      phoneE164: null,
      phoneValid: false,
    });
  });
});
