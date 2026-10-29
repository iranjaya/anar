import { AppError, type AppErrorCode } from "@anar/domain/errors";
import type { FastifyInstance, FastifyRequest } from "fastify";

const statuses: Record<AppErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation: 400,
  conflict: 409,
  step_up_required: 428,
  unavailable: 503,
};

export function originGuard(publicOrigin: string) {
  return (request: FastifyRequest): void => {
    if (request.headers.origin !== publicOrigin)
      throw new AppError("forbidden", "This request origin is not allowed");
  };
}

export const safeLogger = {
  redact: {
    paths: [
      "req.headers",
      "req.body",
      "req.query",
      "res.headers",
      "body",
      "email",
      "name",
      "ip",
      "token",
      "code",
      "password",
      "otpPepper",
      "mailKey",
      "connectionString",
    ],
    remove: true,
  },
  serializers: {
    req(request: FastifyRequest) {
      return {
        id: request.id,
        method: request.method,
        route: request.routeOptions?.url ?? "unmatched",
      };
    },
    res(reply: { statusCode: number }) {
      return { statusCode: reply.statusCode };
    },
    err() {
      return { type: "Error", message: "Request failed", stack: "[Redacted]" };
    },
  },
};

export function registerHttp(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("Cache-Control", "private, no-store");
    reply.header("X-Request-Id", request.id);
    return payload;
  });
  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .send({ ok: false, error: "not_found", message: "Not found" }),
  );
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError)
      return reply
        .code(statuses[error.code])
        .send({ ok: false, error: error.code, message: error.message });
    if (
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    )
      return reply
        .code(400)
        .send({ ok: false, error: "validation", message: "Invalid request" });
    request.log.error({ requestId: request.id }, "Request failed");
    return reply.code(500).send({
      ok: false,
      error: "unavailable",
      message: "Something went wrong. Try again.",
    });
  });
}
