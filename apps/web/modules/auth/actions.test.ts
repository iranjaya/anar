import { describe, expect, it } from "vitest";
import { freshCodeAction } from "./actions";

describe("the shared fresh code action", () => {
  const form = (values: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  };

  it("refuses an unknown code action", async () => {
    expect(await freshCodeAction(null, form({ intent: "other" }))).toEqual({
      ok: false,
      error: "validation",
      message: "Choose a code action.",
    });
  });

  it.each(["request", "verify"])(
    "refuses to %s a code when sign-in is off",
    async (intent) => {
      expect(
        await freshCodeAction(null, form({ intent, code: "123456" })),
      ).toEqual({
        ok: false,
        error: "unavailable",
        message: "Sign-in is not available yet.",
      });
    },
  );
});
