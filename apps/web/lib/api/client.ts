import "server-only";
import { wireDateSchema } from "@anar/domain/http";
import { cookies, headers } from "next/headers";
import type { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseApiResponse } from "./response";

export const apiDateSchema = wireDateSchema.transform(
  (value) => new Date(value),
);
export type ApiRequest = {
  path: string;
  query?: Record<string, string>;
  timeoutMs?: number;
} & ({ method?: "GET" } | { method: "POST"; body: unknown });

export async function apiRequest<T>(
  request: ApiRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    const base = process.env.API_INTERNAL_URL;
    if (!base)
      throw new AppError(
        "unavailable",
        "The service is not available. Try again later.",
      );
    const url = new URL(request.path, base);
    if (
      url.origin !== new URL(base).origin ||
      !url.pathname.startsWith("/api/") ||
      url.hash
    )
      throw new AppError(
        "unavailable",
        "The service is not available. Try again later.",
      );
    for (const [key, value] of Object.entries(request.query ?? {}))
      url.searchParams.set(key, value);
    const incoming = await headers();
    const outgoing = new Headers({ Accept: "application/json" });
    const session = (await cookies()).get("anar_session");
    if (session)
      outgoing.set(
        "Cookie",
        `anar_session=${encodeURIComponent(session.value)}`,
      );
    const requestId = incoming.get("x-request-id");
    if (requestId) outgoing.set("X-Request-Id", requestId);
    if (request.method === "POST") {
      const origin = incoming.get("origin");
      if (!origin || origin === "null")
        throw new AppError("forbidden", "This request origin is not allowed.");
      outgoing.set("Origin", origin);
      outgoing.set("Content-Type", "application/json");
    }
    const response = await fetch(url, {
      method: request.method ?? "GET",
      headers: outgoing,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(request.timeoutMs ?? 10000),
      ...(request.method === "POST"
        ? { body: JSON.stringify(request.body) }
        : {}),
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
