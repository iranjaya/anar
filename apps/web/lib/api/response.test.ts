import { okSchema } from "@anar/domain/auth";
import { describe, expect, it } from "vitest";
import { parseApiResponse } from "./response";

describe("API response errors", () => {
  it("passes a rate limited code request through with its message", async () => {
    const message =
      "Too many codes were sent. Wait a few minutes and try again.";
    const response = new Response(
      JSON.stringify({ ok: false, error: "validation", message }),
      { status: 429, headers: { "content-type": "application/json" } },
    );
    await expect(parseApiResponse(response, okSchema)).rejects.toMatchObject({
      code: "validation",
      message,
    });
  });
});
