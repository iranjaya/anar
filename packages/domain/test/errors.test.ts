import {
  AppError,
  type AppErrorCode,
  actionFailure,
} from "@anar/domain/errors";
import { describe, expect, it } from "vitest";
import {
  AppError as WebAppError,
  actionFailure as webActionFailure,
} from "../../../apps/web/lib/errors.js";

const codes: AppErrorCode[] = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation",
  "conflict",
  "unavailable",
];

describe("shared errors", () => {
  it("keeps one error class through the web exports", () => {
    expect(WebAppError).toBe(AppError);
  });

  it.each(codes)("returns %s through the web exports", (code) => {
    const error = new AppError(code, "Could not save.");
    expect(error).toBeInstanceOf(WebAppError);
    expect(error.name).toBe("AppError");

    try {
      throw error;
    } catch (caught) {
      expect(webActionFailure(caught)).toEqual({
        ok: false,
        error: code,
        message: "Could not save.",
      });
    }

    expect(actionFailure(error)).toEqual({
      ok: false,
      error: code,
      message: "Could not save.",
    });
  });

  it.each([
    new Error("Unexpected failure."),
    { code: "validation", message: "Not an AppError." },
    "Unexpected failure.",
    null,
    undefined,
  ])("throws an unknown error unchanged (%#)", (error) => {
    expect.assertions(1);
    try {
      webActionFailure(error);
    } catch (caught) {
      expect(caught).toBe(error);
    }
  });
});
