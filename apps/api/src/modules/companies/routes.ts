import { inviteResultSchema } from "@anar/domain/auth";
import {
  type CompanyListQuery,
  type CreateCompanyInput,
  companyPageSchema,
  createCompanyResultSchema,
  type InviteSuperAdminInput,
} from "@anar/domain/companies";
import { apiSuccessSchema } from "@anar/domain/http";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CompanyService } from "./service.js";

export type CompanyRouteOptions = {
  companies: CompanyService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};
const routes = {
  async register(
    app: FastifyInstance,
    options: CompanyRouteOptions,
  ): Promise<void> {
    const created = apiSuccessSchema(createCompanyResultSchema);
    const listed = apiSuccessSchema(companyPageSchema);
    const invited = apiSuccessSchema(inviteResultSchema);
    app.post<{ Body: InviteSuperAdminInput }>(
      "/api/companies/inviteSuperAdmin",
      {
        onRequest: async (request) => {
          await options.requireOrigin(request);
        },
      },
      async (request, reply) => {
        const actor = await options.companies.requireAgencyContext(request);
        const result = await options.companies.inviteSuperAdmin(
          actor,
          request.body,
          { ip: request.ip },
        );
        return reply.send(invited.parse({ ok: true, data: result }));
      },
    );
    app.post<{ Body: CreateCompanyInput }>(
      "/api/companies/createCompany",
      {
        onRequest: async (request) => {
          await options.requireOrigin(request);
        },
      },
      async (request, reply) => {
        const actor = await options.companies.requireAgencyContext(request);
        const result = await options.companies.createCompany(
          actor,
          request.body,
          { ip: request.ip },
        );
        return reply.send(created.parse({ ok: true, data: result }));
      },
    );
    app.get<{ Querystring: CompanyListQuery }>(
      "/api/companies/listCompanies",
      async (request, reply) => {
        const actor = await options.companies.requireAgencyContext(request);
        const page = await options.companies.listCompanies(
          actor,
          request.query,
        );
        return reply.send(
          listed.parse({
            ok: true,
            data: {
              ...page,
              items: page.items.map((company) => ({
                ...company,
                lastImportAt: company.lastImportAt?.toISOString() ?? null,
              })),
            },
          }),
        );
      },
    );
  },
};
export default routes;
