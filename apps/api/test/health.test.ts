import { healthResponseSchema } from "@anar/domain/health";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("API health", () => {
  const fresh = {
    db: "ok" as const,
    lastSeenAt: new Date("2026-10-31T00:00:00.000Z"),
    workerHealthy: true,
    queue: { waiting: 1, active: 0, failed: 2 },
  };
  async function check(
    state?: typeof fresh | (Omit<typeof fresh, "queue"> & { queue: null }),
  ) {
    const app = buildApp(
      state ? ({ health: { read: async () => state } } as never) : undefined,
    );
    try {
      const response = await app.inject({ method: "GET", url: "/api/health" });
      expect(response.headers["content-type"]).toBe(
        "application/json; charset=utf-8",
      );
      expect(healthResponseSchema.parse(response.json())).toEqual(
        response.json(),
      );
      expect(app.server.listening).toBe(false);
      return { status: response.statusCode, body: response.json() };
    } finally {
      await app.close();
    }
  }

  it("is ok when the database, queue and worker heartbeat are fine", async () => {
    expect(await check(fresh)).toEqual({
      status: 200,
      body: {
        status: "ok",
        service: "api",
        db: "ok",
        worker: { lastSeenAt: "2026-10-31T00:00:00.000Z", healthy: true },
        queue: { waiting: 1, active: 0, failed: 2 },
      },
    });
  });

  it.each([
    { name: "the heartbeat is old", state: { ...fresh, workerHealthy: false } },
    { name: "the queue query fails", state: { ...fresh, queue: null } },
    {
      name: "the database is down",
      state: {
        db: "down" as const,
        lastSeenAt: null,
        workerHealthy: false,
        queue: null,
      },
    },
  ])("returns 503 when $name", async ({ state }) => {
    const { status, body } = await check(state as never);
    expect(status).toBe(503);
    expect(body.status).toBe("degraded");
  });

  it("returns 503 when no health check is wired", async () => {
    expect(await check()).toEqual({
      status: 503,
      body: {
        status: "degraded",
        service: "api",
        db: "down",
        worker: { lastSeenAt: null, healthy: false },
        queue: null,
      },
    });
  });
});

describe("API routes", () => {
  it("registers only GET health", async () => {
    const app = buildApp();
    const routes: { method: string | string[]; url: string }[] = [];
    app.addHook("onRoute", ({ method, url }) => {
      routes.push({ method, url });
    });
    try {
      await app.ready();
      expect(routes).toEqual([{ method: "GET", url: "/api/health" }]);
    } finally {
      await app.close();
    }
  });

  it.each([
    { method: "GET", url: "/api/unknown" },
    { method: "GET", url: "/api/leads" },
    { method: "GET", url: "/api/ready" },
    { method: "POST", url: "/api/health" },
    { method: "HEAD", url: "/api/health" },
  ] as const)("returns 404 for $method $url", async (request) => {
    const app = buildApp();
    try {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
