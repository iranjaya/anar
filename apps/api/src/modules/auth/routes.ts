import {
  emptySchema,
  okSchema,
  type RequestOtpInput,
  revokeSessionSchema,
  type StepUpInput,
  sessionListSchema,
  type VerifyOtpInput,
  verifyOtpResultSchema,
} from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { apiSuccessSchema } from "@anar/domain/http";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { OtpService, StepUpService, VerifierService } from "./otp.js";
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
export type SessionRouteOptions = {
  sessions: Pick<
    SessionService,
    | "requireSession"
    | "listSessions"
    | "revokeSession"
    | "logout"
    | "clearCookie"
  >;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};
export type StepUpRouteOptions = {
  stepUp: StepUpService;
  sessions: Pick<SessionService, "requireSession">;
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

  async registerSessions(
    app: FastifyInstance,
    options: SessionRouteOptions,
  ): Promise<void> {
    const success = apiSuccessSchema(okSchema);
    const listSuccess = apiSuccessSchema(sessionListSchema);
    const onRequest = async (request: FastifyRequest) => {
      await options.requireOrigin(request);
    };

    app.get("/api/auth/listSessions", async (request, reply) => {
      if (!emptySchema.safeParse(request.query).success) {
        throw new AppError("validation", "List sessions takes no query");
      }
      const actor = await options.sessions.requireSession(request);
      const list = await options.sessions.listSessions(actor);
      return reply
        .header("Cache-Control", "private, no-store")
        .send(listSuccess.parse({ ok: true, data: list }));
    });

    app.post(
      "/api/auth/revokeSession",
      { onRequest },
      async (request, reply) => {
        const input = revokeSessionSchema.safeParse(request.body);
        if (!input.success) {
          throw new AppError("validation", "A session ID is required");
        }
        const actor = await options.sessions.requireSession(request);
        await options.sessions.revokeSession(actor, input.data.sessionId);
        if (input.data.sessionId.toLowerCase() === actor.session.id) {
          reply.header("Set-Cookie", options.sessions.clearCookie());
        }
        return reply
          .header("Cache-Control", "private, no-store")
          .send(success.parse({ ok: true, data: { ok: true } }));
      },
    );

    app.post("/api/auth/logout", { onRequest }, async (request, reply) => {
      if (!emptySchema.safeParse(request.body).success) {
        throw new AppError("validation", "Logout requires an empty object");
      }
      await options.sessions.logout(request);
      return reply
        .header("Cache-Control", "private, no-store")
        .header("Set-Cookie", options.sessions.clearCookie())
        .send(success.parse({ ok: true, data: { ok: true } }));
    });
  },

  async registerStepUp(
    app: FastifyInstance,
    options: StepUpRouteOptions,
  ): Promise<void> {
    const success = apiSuccessSchema(okSchema);
    const onRequest = async (request: FastifyRequest) => {
      await options.requireOrigin(request);
    };
    app.post(
      "/api/auth/requestStepUp",
      { onRequest },
      async (request, reply) => {
        if (!emptySchema.safeParse(request.body).success) {
          throw new AppError(
            "validation",
            "Request step-up requires an empty object",
          );
        }
        const actor = await options.sessions.requireSession(request);
        const result = await options.stepUp.requestStepUp(actor, {
          ip: request.ip,
        });
        if (!result.sent)
          return reply
            .code(429)
            .header("Cache-Control", "private, no-store")
            .send({
              ok: false,
              error: "validation",
              message:
                "Too many codes were sent. Wait a few minutes and try again.",
            });
        return reply
          .header("Cache-Control", "private, no-store")
          .send(success.parse({ ok: true, data: { ok: true } }));
      },
    );
    app.post<{ Body: StepUpInput }>(
      "/api/auth/stepUp",
      { onRequest },
      async (request, reply) => {
        const actor = await options.sessions.requireSession(request);
        const result = await options.stepUp.stepUp(actor, request.body);
        return reply
          .header("Cache-Control", "private, no-store")
          .send(success.parse({ ok: true, data: result }));
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
