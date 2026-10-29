"use client";

import {
  okSchema,
  type RequestOtpInput,
  requestOtpSchema,
  type VerifyOtpInput,
  verifyOtpResultSchema,
  verifyOtpSchema,
} from "@anar/domain/auth";
import type { z } from "zod";
import { parseApiResponse } from "@/lib/api/response";
import { AppError } from "@/lib/errors";

async function post<T>(
  path: "/api/auth/requestOtp" | "/api/auth/verifyOtp",
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    return await parseApiResponse(response, schema);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "unavailable",
      "Could not reach the service. Try again.",
    );
  }
}

export async function requestOtp(input: RequestOtpInput) {
  const parsed = requestOtpSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Enter your email address.");
  return post("/api/auth/requestOtp", parsed.data, okSchema);
}

export async function verifyOtp(input: VerifyOtpInput) {
  const parsed = verifyOtpSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Enter your email and six-digit code.");
  return post("/api/auth/verifyOtp", parsed.data, verifyOtpResultSchema);
}
