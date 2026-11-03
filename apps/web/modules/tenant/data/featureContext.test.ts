import type { ContextView } from "@anar/domain/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "../types";

const getCompanyContext = vi.fn();
const requireContext = vi.fn();
vi.mock("../server", () => ({ getCompanyContext }));
vi.mock("./context", () => ({ requireContext }));
const { hasCapability, requireFeatureContext } = await import(
  "./featureContext"
);

const real = { capabilities: ["members.list"] } as unknown as ContextView;
const demo = (role: Ctx["role"]): Ctx => ({
  user: { id: "u1" } as Ctx["user"],
  companyId: "c1",
  member: null,
  role,
  session: { id: "demo", actingCompanyId: null },
});

describe("feature context", () => {
  beforeEach(() => {
    getCompanyContext.mockReset();
    requireContext.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads capabilities from a real view", () => {
    expect(hasCapability(real, "members.list")).toBe(true);
    expect(hasCapability(real, "settings.manage")).toBe(false);
  });

  it("uses the demo policy for a demo context", () => {
    expect(hasCapability(demo("super_admin"), "settings.manage")).toBe(true);
    expect(hasCapability(demo("admin"), "settings.manage")).toBe(false);
  });

  it("says no for a permission the demo does not know", () => {
    expect(hasCapability(demo("dna"), "agency.create")).toBe(false);
  });

  it("uses the demo resolver in demo mode", async () => {
    requireContext.mockResolvedValue(demo("admin"));
    expect(await requireFeatureContext("demo-co")).toEqual(demo("admin"));
    expect(getCompanyContext).not.toHaveBeenCalled();
  });

  it("returns the real view in real mode", async () => {
    vi.stubEnv("ANAR_DATA_MODE", "real");
    getCompanyContext.mockResolvedValue({ ok: true, data: real });
    expect(await requireFeatureContext("real-co")).toBe(real);
    expect(requireContext).not.toHaveBeenCalled();
  });

  it("throws the real failure and never falls back to the demo", async () => {
    vi.stubEnv("ANAR_DATA_MODE", "real");
    getCompanyContext.mockResolvedValue({
      ok: false,
      error: "forbidden",
      message: "Company entry is required",
    });
    await expect(requireFeatureContext("real-co")).rejects.toMatchObject({
      code: "forbidden",
      message: "Company entry is required",
    });
    getCompanyContext.mockResolvedValue(null);
    await expect(requireFeatureContext("real-co")).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(requireContext).not.toHaveBeenCalled();
  });
});
