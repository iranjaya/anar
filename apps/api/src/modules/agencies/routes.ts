import {
  type AgencyListQuery,
  agencyPageSchema,
  type CreateAgencyInput,
  createAgencyResultSchema,
  type ResendFirstInviteInput,
} from "@anar/domain/agencies";
import { okSchema } from "@anar/domain/auth";
import { apiSuccessSchema } from "@anar/domain/http";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AgencyService } from "./service.js";

export type AgencyRouteOptions = {
  agencies: AgencyService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};

const routes = {
  async register(
    app: FastifyInstance,
    options: AgencyRouteOptions,
  ): Promise<void> {
    const created = apiSuccessSchema(createAgencyResultSchema);
    const page = apiSuccessSchema(agencyPageSchema);
    const success = apiSuccessSchema(okSchema);
    app.post<{ Body: ResendFirstInviteInput }>(
      "/api/agencies/resendFirstInvite",
      {
        onRequest: async (request) => {
          await options.requireOrigin(request);
        },
      },
      async (request, reply) => {
        const actor = await options.agencies.requireOwner(request);
        const limit = await options.agencies.resendFirstInvite(
          actor,
          request.body,
          {
            ip: request.ip,
          },
        );
        if (!limit.allowed)
          return reply
            .code(429)
            .header("Retry-After", String(limit.retryAfter))
            .send({
              ok: false,
              error: "validation",
              message: "Too many invite resends. Try again later.",
            });
        return reply
          .header("Cache-Control", "private, no-store")
          .send(success.parse({ ok: true, data: { ok: true } }));
      },
    );
    app.post<{ Body: CreateAgencyInput }>(
      "/api/agencies/createAgency",
      {
        onRequest: async (request) => {
          await options.requireOrigin(request);
        },
      },
      async (request, reply) => {
        const actor = await options.agencies.requireOwner(request);
        const result = await options.agencies.createAgency(
          actor,
          request.body,
          { ip: request.ip },
        );
        return reply
          .header("Cache-Control", "private, no-store")
          .send(created.parse({ ok: true, data: result }));
      },
    );
    app.get<{ Querystring: AgencyListQuery }>(
      "/api/agencies/listAgencies",
      async (request, reply) => {
        const actor = await options.agencies.requireOwner(request);
        const result = await options.agencies.listAgencies(
          actor,
          request.query,
        );
        return reply.header("Cache-Control", "private, no-store").send(
          page.parse({
            ok: true,
            data: {
              items: result.items.map((agency) => ({
                ...agency,
                createdAt: agency.createdAt.toISOString(),
              })),
              nextCursor: result.nextCursor,
            },
          }),
        );
      },
    );
  },
};

export default routes;
