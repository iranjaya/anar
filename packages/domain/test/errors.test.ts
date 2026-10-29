import {
  AppError,
  type AppErrorCode,
  actionFailure,
} from "@anar/domain/errors";
import { describe, expect, it } from "vitest";

const codes: AppErrorCode[] = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation",
  "conflict",
  "unavailable",
];

describe("shared errors", () => {
  it.each(codes)("returns %s from an AppError", (code) => {
    const error = new AppError(code, "Could not save.");
    expect(error.name).toBe("AppError");

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
      actionFailure(error);
    } catch (caught) {
      expect(caught).toBe(error);
    }
  });
});
