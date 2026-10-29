import { healthResponseSchema } from "@anar/domain/health";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("API health", () => {
  const app = buildApp();
  afterEach(() => app.close());

  it("returns the exact health body without opening a socket", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.json()).toEqual({ status: "ok", service: "api" });
    expect(healthResponseSchema.parse(response.json())).toEqual(
      response.json(),
    );
    expect(app.server.listening).toBe(false);
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
