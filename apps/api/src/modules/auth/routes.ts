import {
  emptySchema,
  okSchema,
  type RequestOtpInput,
  type VerifyOtpInput,
  verifyOtpResultSchema,
} from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { apiSuccessSchema } from "@anar/domain/http";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { OtpService, VerifierService } from "./otp.js";
import type { SessionService } from "./sessions.js";

export type AuthRouteOptions = {
  otp: OtpService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};
export type VerifyRouteOptions = {
  verifier: VerifierService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};
export type RefreshRouteOptions = {
  sessions: Pick<SessionService, "refreshSession">;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};

const routes = {
  async register(
    app: FastifyInstance,
    options: AuthRouteOptions,
  ): Promise<void> {
    const success = apiSuccessSchema(okSchema);
    app.post<{ Body: RequestOtpInput }>(
      "/api/auth/requestOtp",
      {
        onRequest: async (request) => {
          await options.requireOrigin(request);
        },
      },
      async (request, reply) => {
        const result = await options.otp.requestOtp(request.body, {
          ip: request.ip,
        });
        return reply
          .header("Cache-Control", "private, no-store")
          .send(success.parse({ ok: true, data: result }));
      },
    );
  },

  async registerVerification(
    app: FastifyInstance,
    options: VerifyRouteOptions,
  ): Promise<void> {
    const success = apiSuccessSchema(verifyOtpResultSchema);
    app.post<{ Body: VerifyOtpInput }>(
      "/api/auth/verifyOtp",
      {
        onRequest: async (request) => {
          await options.requireOrigin(request);
        },
      },
      async (request, reply) => {
        const issue = await options.verifier.verifyOtp(request.body, {
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        });
        return reply
          .header("Cache-Control", "private, no-store")
          .header("Set-Cookie", issue.cookie)
          .send(
            success.parse({ ok: true, data: { redirectTo: issue.redirectTo } }),
          );
      },
    );
  },

  async registerRefresh(
    app: FastifyInstance,
    options: RefreshRouteOptions,
  ): Promise<void> {
    const success = apiSuccessSchema(okSchema);
    app.post(
      "/api/auth/refresh",
      {
        onRequest: async (request) => {
          await options.requireOrigin(request);
        },
      },
      async (request, reply) => {
        if (!emptySchema.safeParse(request.body).success) {
          throw new AppError("validation", "Refresh requires an empty object");
        }
        const issue = await options.sessions.refreshSession(request);
        return reply
          .header("Cache-Control", "private, no-store")
          .header("Set-Cookie", issue.cookie)
          .send(success.parse({ ok: true, data: { ok: true } }));
      },
    );
  },
};

export default routes;
