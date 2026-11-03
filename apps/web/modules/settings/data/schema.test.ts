import type { ContextView } from "@anar/domain/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDemoStore } from "@/mock/access";
import { resolveContext } from "@/modules/tenant/server";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiRequest }));
const { createFields, loadSchema } = await import("./schema");

const companyId = "a1000000-0000-4000-8000-000000000001";
const real = {
  capabilities: ["settings.manage"],
  company: { slug: "real-co" },
} as unknown as ContextView;
const wire = {
  fields: [
    {
      id: "01900000-0000-7000-8000-000000000001",
      companyId,
      key: "budget_fit",
      label: "Budget fit",
      type: "dropdown",
      options: [{ value: "Yes", label: "Yes" }],
      isSystem: false,
      position: 0,
      archivedAt: null,
    },
  ],
  stages: [],
  outcomes: [],
  lostReasons: [],
};

describe("settings schema reads", () => {
  beforeEach(async () => {
    apiRequest.mockReset();
    await resetDemoStore(new Date("2026-10-31T06:00:00Z"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the demo store in demo mode and never calls the API", async () => {
    const ctx = await resolveContext(
      { userId: "sunaina", actingCompanyId: null },
      "sundar-heights",
    );
    const schema = await loadSchema(ctx);
    expect(schema.fields.length).toBeGreaterThan(0);
    expect(schema.fields.every((f) => f.companyId === ctx.companyId)).toBe(
      true,
    );
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("refuses a real view in demo mode", async () => {
    await expect(loadSchema(real)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("reads the company schema over HTTP in real mode", async () => {
    vi.stubEnv("ANAR_DATA_MODE", "real");
    apiRequest.mockImplementation(async (_request, schema) =>
      schema.parse(wire),
    );
    const schema = await loadSchema(real);
    expect(apiRequest).toHaveBeenCalledWith(
      { path: "/api/companies/real-co/settings/loadSchema" },
      expect.anything(),
    );
    expect(schema.fields[0]).toMatchObject({
      key: "budget_fit",
      archivedAt: null,
    });
  });

  it("passes a real outage through instead of reading the demo", async () => {
    vi.stubEnv("ANAR_DATA_MODE", "real");
    apiRequest.mockRejectedValue(
      Object.assign(new Error("down"), { code: "unavailable" }),
    );
    await expect(loadSchema(real)).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("refuses a demo context in real mode", async () => {
    const ctx = await resolveContext(
      { userId: "sunaina", actingCompanyId: null },
      "sundar-heights",
    );
    vi.stubEnv("ANAR_DATA_MODE", "real");
    await expect(loadSchema(ctx)).rejects.toMatchObject({ code: "forbidden" });
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("does not create fields in real mode yet", async () => {
    vi.stubEnv("ANAR_DATA_MODE", "real");
    await expect(createFields(real, [])).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
