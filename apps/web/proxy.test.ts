import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

const batch = "01900000-0000-7000-8000-000000000001";
const status = (path: string, method = "GET") =>
  proxy(new NextRequest(`http://anar.test${path}`, { method })).status;

describe("real-mode routes", () => {
  beforeEach(() => {
    vi.stubEnv("ANAR_DATA_MODE", "real");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    "/client-one/imports/new",
    `/client-one/imports/${batch}`,
    `/client-one/imports/${batch}/map`,
    "/client-one/notifications",
    "/client-one/settings",
    "/client-one/leads",
    `/client-one/leads/${batch}`,
    "/client-one/today",
  ])("allows %s", (path) => {
    expect(status(path)).not.toBe(404);
  });

  it.each([
    "/client-one/imports/not-a-batch/map",
    `/client-one/imports/${batch}/map/extra`,
    "/client-one/leads/not-a-lead",
    `/client-one/leads/${batch}/edit`,
  ])("keeps %s blocked", (path) => {
    expect(status(path)).toBe(404);
  });

  it.each([
    "/sw.js",
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/apple-icon.png",
  ])("serves %s to a signed-out GET", (path) => {
    expect(status(path)).not.toBe(404);
  });

  it("does not serve the push assets to other methods", () => {
    expect(status("/sw.js", "POST")).toBe(404);
  });
});
