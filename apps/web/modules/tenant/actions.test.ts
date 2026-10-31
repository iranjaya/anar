import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetDemoAction,
  setDemoFailureAction,
  switchDemoUserAction,
} from "./actions";
import { verifyContext } from "./server";
import type { Ctx } from "./types";

describe("demo actions in real mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses every demo action", async () => {
    vi.stubEnv("ANAR_DATA_MODE", "real");
    const refused = {
      ok: false,
      error: "forbidden",
      message: "This is not available yet.",
    };
    expect(await resetDemoAction()).toEqual(refused);
    expect(await switchDemoUserAction({ userId: "rohan" })).toEqual(refused);
    expect(await setDemoFailureAction({ on: true })).toEqual(refused);
  });

  it("refuses to verify a demo context", async () => {
    vi.stubEnv("ANAR_DATA_MODE", "real");
    await expect(verifyContext({} as Ctx)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
