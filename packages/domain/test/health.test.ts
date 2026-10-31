import { type HealthResponse, healthResponseSchema } from "@anar/domain/health";
import { describe, expect, it } from "vitest";

describe("health response", () => {
  const healthy: HealthResponse = {
    status: "ok",
    service: "api",
    db: "ok",
    worker: { lastSeenAt: "2026-10-31T00:00:00.000Z", healthy: true },
    queue: { waiting: 0, active: 1, failed: 2 },
  };

  it("accepts a healthy and a degraded response", () => {
    expect(healthResponseSchema.parse(healthy)).toEqual(healthy);
    const degraded: HealthResponse = {
      status: "degraded",
      service: "api",
      db: "down",
      worker: { lastSeenAt: null, healthy: false },
      queue: null,
    };
    expect(healthResponseSchema.parse(degraded)).toEqual(degraded);
  });

  it.each([
    null,
    {},
    { status: "ok" },
    { service: "api" },
    { status: "error", service: "api" },
    { status: "ok", service: "worker" },
    { status: "ok", service: "api" },
    { ...healthy, status: "error" },
    { ...healthy, worker: { lastSeenAt: "yesterday", healthy: true } },
    { ...healthy, queue: { waiting: -1, active: 0, failed: 0 } },
    { ...healthy, secret: "x" },
  ])("rejects an invalid health response (%#)", (response) => {
    expect(healthResponseSchema.safeParse(response).success).toBe(false);
  });
});
