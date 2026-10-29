import {
  type AcceptInviteInput,
  acceptInviteResultSchema,
  type InviteTokenInput,
  inviteViewSchema,
} from "@anar/domain/auth";
import { apiSuccessSchema } from "@anar/domain/http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { InviteAcceptanceService } from "./inviteAcceptance.js";
import type { InviteOperation } from "./rateLimits.js";

export type InviteRouteOptions = {
  invites: InviteAcceptanceService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};

const inviteRoutes = {
  async register(
    app: FastifyInstance,
    options: InviteRouteOptions,
  ): Promise<void> {
    const inspect = apiSuccessSchema(inviteViewSchema);
    const accept = apiSuccessSchema(acceptInviteResultSchema);
    const guard =
      (operation: InviteOperation) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        await options.requireOrigin(request);
        const limit = await options.invites.admit(operation, request.ip);
        if (!limit.allowed)
          return reply
            .code(429)
            .header("Retry-After", String(limit.retryAfter))
            .send({
              ok: false,
              error: "validation",
              message: "Too many invite requests. Try again later.",
            });
      };
    app.post<{ Body: InviteTokenInput }>(
      "/api/auth/inspectInvite",
      { onRequest: guard("inspect") },
      async (request, reply) => {
        const view = await options.invites.inspectInvite(request.body);
        return reply.header("Cache-Control", "private, no-store").send(
          inspect.parse({
            ok: true,
            data: { ...view, expiresAt: view.expiresAt.toISOString() },
          }),
        );
      },
    );
    app.post<{ Body: AcceptInviteInput }>(
      "/api/auth/acceptInvite",
      { onRequest: guard("accept") },
      async (request, reply) => {
        const result = await options.invites.acceptInvite(request.body, {
          ip: request.ip,
        });
        return reply
          .header("Cache-Control", "private, no-store")
          .send(accept.parse({ ok: true, data: result }));
      },
    );
  },
};

export default inviteRoutes;
