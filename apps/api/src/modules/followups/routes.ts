import { slugSchema } from "@anar/domain/agencies";
import { AppError } from "@anar/domain/errors";
import {
  type LogFollowUpWireInput,
  logFollowUpResultWireSchema,
  logFollowUpWire,
} from "@anar/domain/followups";
import { apiSuccessSchema } from "@anar/domain/http";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { FollowUpService } from "./service.js";

export type FollowUpRouteOptions = {
  followUps: FollowUpService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};

const routes = {
  async register(
    app: FastifyInstance,
    { followUps, requireOrigin }: FollowUpRouteOptions,
  ): Promise<void> {
    const response = apiSuccessSchema(logFollowUpResultWireSchema);
    app.post<{ Params: { slug: string }; Body: LogFollowUpWireInput }>(
      "/api/companies/:slug/followups/logFollowUp",
      {
        onRequest: async (request) => {
          await requireOrigin(request);
        },
      },
      async (request, reply) => {
        const slug = slugSchema.safeParse(request.params.slug);
        if (!slug.success)
          throw new AppError("validation", "A valid company slug is required");
        const actor = await followUps.requireContext(request, slug.data);
        const result = await followUps.logFollowUp(actor, request.body, {
          ip: request.ip,
        });
        return reply.send(
          response.parse({ ok: true, data: logFollowUpWire(result) }),
        );
      },
    );
  },
};
export default routes;
