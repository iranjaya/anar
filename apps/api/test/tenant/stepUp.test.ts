import { stepUpSchema } from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { apiFailureSchema } from "@anar/domain/http";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import stepUp from "../../src/modules/tenant/stepUp.js";

describe("fresh OTP", () => {
  const lastOtpAt = new Date("2026-10-29T00:00:00.000Z");
  const actor = { session: { lastOtpAt } };

  it.each([0, 899999, 900000])("allows age %s ms", (elapsed) => {
    expect(() =>
      stepUp.requireFreshOtp(actor, new Date(lastOtpAt.getTime() + elapsed)),
    ).not.toThrow();
  });

  it.each([900001, 1800000])("requires a new code at age %s ms", (elapsed) => {
    expect(() =>
      stepUp.requireFreshOtp(actor, new Date(lastOtpAt.getTime() + elapsed)),
    ).toThrow(
      new AppError("step_up_required", "Verify a fresh code to continue"),
    );
  });

  it("accepts only a six-digit code with no identity selectors", () => {
    expect(stepUpSchema.parse({ code: "012345" })).toEqual({ code: "012345" });
    for (const body of [
      null,
      {},
      { code: 123456 },
      { code: "12345" },
      { code: "1234567" },
      { code: "abcdef" },
      { code: "012345", email: "other@example.test" },
      { code: "012345", sessionId: "other" },
    ]) {
      expect(stepUpSchema.safeParse(body).success).toBe(false);
    }
  });

  it("returns 428 before a stale actor reaches the protected action", async () => {
    const app = buildApp();
    let writes = 0;
    app.get("/proof/freshness", async () => {
      stepUp.requireFreshOtp(actor, new Date(lastOtpAt.getTime() + 900001));
      writes++;
      return { ok: true };
    });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/proof/freshness",
      });
      expect(response.statusCode).toBe(428);
      expect(apiFailureSchema.parse(response.json())).toEqual({
        ok: false,
        error: "step_up_required",
        message: "Verify a fresh code to continue",
      });
      expect(writes).toBe(0);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    } finally {
      await app.close();
    }
  });
});
