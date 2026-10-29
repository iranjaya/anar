import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDemoStore, setDemoFailure, store } from "./access";

const now = new Date("2026-10-28T12:00:00+05:45");

describe("mock access", () => {
  beforeEach(async () => {
    await resetDemoStore(now);
  });
  afterEach(async () => {
    await setDemoFailure(false);
  });

  it("returns the seeded store while failure is off", async () => {
    const data = await store();
    expect(data.companies.map((company) => company.slug).sort()).toEqual([
      "pahad-view",
      "sundar-heights",
    ]);
  });

  it("rejects every read while failure is on", async () => {
    await setDemoFailure(true);
    await expect(store()).rejects.toMatchObject({
      name: "AppError",
      code: "unavailable",
    });
    await expect(store()).rejects.toMatchObject({
      name: "AppError",
      code: "unavailable",
    });
  });

  it("loads again after failure is switched off", async () => {
    await setDemoFailure(true);
    await expect(store()).rejects.toMatchObject({ code: "unavailable" });
    await setDemoFailure(false);
    expect((await store()).companies).toHaveLength(2);
  });

  it("restores seed data and clears failure on reset", async () => {
    const previous = await store();
    previous.leads.length = 0;
    await setDemoFailure(true);
    await expect(store()).rejects.toMatchObject({ code: "unavailable" });
    await resetDemoStore(now);
    const data = await store();
    expect(data).not.toBe(previous);
    expect(data.leads).toHaveLength(420);
  });
});
