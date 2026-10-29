import { type HealthResponse, healthResponseSchema } from "@anar/domain/health";
import { describe, expect, it } from "vitest";

describe("health response", () => {
  it("accepts the API liveness response", () => {
    const response: HealthResponse = { status: "ok", service: "api" };
    expect(healthResponseSchema.parse(response)).toEqual(response);
  });

  it.each([
    null,
    {},
    { status: "ok" },
    { service: "api" },
    { status: "error", service: "api" },
    { status: "ok", service: "worker" },
  ])("rejects an invalid health response (%#)", (response) => {
    expect(healthResponseSchema.safeParse(response).success).toBe(false);
  });
});
