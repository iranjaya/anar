import { z } from "zod";
import type { AppErrorCode } from "./errors.js";

const errorCodes = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation",
  "conflict",
  "step_up_required",
  "unavailable",
] as const satisfies readonly AppErrorCode[];

export const apiFailureSchema = z.strictObject({
  ok: z.literal(false),
  error: z.enum(errorCodes),
  message: z.string(),
});

export function apiSuccessSchema<T extends z.ZodType>(payload: T) {
  return z.strictObject({ ok: z.literal(true), data: payload });
}

export const wireDateSchema = z.iso.datetime();
