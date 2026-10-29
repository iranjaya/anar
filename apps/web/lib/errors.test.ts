import { AppError, type AppErrorCode } from "@anar/domain/errors";
import { describe, expect, it } from "vitest";
import { actionFailure, AppError as WebAppError } from "./errors";

describe("shared error exports", () => {
  it("keeps one error class", () => {
    expect(WebAppError).toBe(AppError);
  });

  it.each<AppErrorCode>([
    "unauthorized",
    "forbidden",
    "not_found",
    "validation",
    "conflict",
    "unavailable",
  ])("returns %s through the web exports", (code) => {
    const error = new AppError(code, "Could not save.");
    expect(error).toBeInstanceOf(WebAppError);
    try {
      throw error;
    } catch (caught) {
      expect(actionFailure(caught)).toEqual({
        ok: false,
        error: code,
        message: "Could not save.",
      });
    }
  });

  it("throws unknown errors unchanged", () => {
    const error = new Error("Unexpected failure.");
    expect(() => actionFailure(error)).toThrow(error);
  });
});
