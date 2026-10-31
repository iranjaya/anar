import {
  type AgencyListQuery,
  type AgencyStaffView,
  agencyInvitePageSchema,
  agencyStaffPageSchema,
  agencyViewSchema,
  type DeactivateStaffInput,
  type InviteStaffInput,
} from "@anar/domain/agencies";
import {
  emptySchema,
  inviteResultSchema,
  okSchema,
  type ResendInviteInput,
} from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { apiSuccessSchema } from "@anar/domain/http";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { StaffService } from "./staff.js";

export type StaffRouteOptions = {
  staff: StaffService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};
const staffRoutes = {
  async register(
    app: FastifyInstance,
    { staff, requireOrigin }: StaffRouteOptions,
  ): Promise<void> {
    const view = apiSuccessSchema(agencyViewSchema);
    const staffPage = apiSuccessSchema(agencyStaffPageSchema);
    const invitePage = apiSuccessSchema(agencyInvitePageSchema);
    const invited = apiSuccessSchema(inviteResultSchema);
    const success = apiSuccessSchema(okSchema);
    const onRequest = async (request: FastifyRequest) => {
      await requireOrigin(request);
    };
    app.post<{ Body: InviteStaffInput }>(
      "/api/agencies/inviteStaff",
      { onRequest },
      async (request, reply) => {
        const actor = await staff.requireAgencyContext(request);
        const result = await staff.inviteStaff(actor, request.body, {
          ip: request.ip,
        });
        return reply.send(invited.parse({ ok: true, data: result }));
      },
    );
    app.post<{ Body: ResendInviteInput }>(
      "/api/agencies/resendStaffInvite",
      { onRequest },
      async (request, reply) => {
        const actor = await staff.requireAgencyContext(request);
        const limit = await staff.resendStaffInvite(actor, request.body, {
          ip: request.ip,
        });
        if (!limit.allowed)
          return reply
            .code(429)
            .header("Retry-After", String(limit.retryAfter))
            .send({
              ok: false,
              error: "validation",
              message: "Too many invite resends. Try again later.",
            });
        return reply.send(success.parse({ ok: true, data: { ok: true } }));
      },
    );
    app.post<{ Body: DeactivateStaffInput }>(
      "/api/agencies/deactivateStaff",
      { onRequest },
      async (request, reply) => {
        const actor = await staff.requireAgencyContext(request);
        await staff.deactivateStaff(actor, request.body, { ip: request.ip });
        return reply.send(success.parse({ ok: true, data: { ok: true } }));
      },
    );
    app.get("/api/agencies/getAgency", async (request, reply) => {
      const actor = await staff.requireAgencyContext(request);
      if (!emptySchema.safeParse(request.query).success)
        throw new AppError(
          "validation",
          "Agency lookup does not accept selectors",
        );
      const current = await staff.getAgency(actor);
      return reply.send(
        view.parse({
          ok: true,
          data: {
            agency: {
              ...current.agency,
              createdAt: current.agency.createdAt.toISOString(),
            },
            staff: staffRoutes._wireStaff(current.staff),
            capabilities: current.capabilities,
          },
        }),
      );
    });
    app.get<{ Querystring: AgencyListQuery }>(
      "/api/agencies/listStaff",
      async (request, reply) => {
        const actor = await staff.requireAgencyContext(request);
        const page = await staff.listStaff(actor, request.query);
        return reply.send(
          staffPage.parse({
            ok: true,
            data: { ...page, items: page.items.map(staffRoutes._wireStaff) },
          }),
        );
      },
    );
    app.get<{ Querystring: AgencyListQuery }>(
      "/api/agencies/listInvites",
      async (request, reply) => {
        const actor = await staff.requireAgencyContext(request);
        const page = await staff.listStaffInvites(actor, request.query);
        return reply.send(
          invitePage.parse({
            ok: true,
            data: {
              ...page,
              items: page.items.map((invite) => ({
                ...invite,
                expiresAt: invite.expiresAt.toISOString(),
                createdAt: invite.createdAt.toISOString(),
              })),
            },
          }),
        );
      },
    );
  },
  _wireStaff(member: AgencyStaffView) {
    return {
      ...member,
      deactivatedAt: member.deactivatedAt?.toISOString() ?? null,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
    };
  },
};
export default staffRoutes;
