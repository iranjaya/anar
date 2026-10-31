import { slugSchema } from "@anar/domain/agencies";
import {
  emptySchema,
  inviteResultSchema,
  okSchema,
  type ResendInviteInput,
} from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { apiSuccessSchema } from "@anar/domain/http";
import {
  agencyEntryListSchema,
  type DeactivateMemberInput,
  deactivateMemberResultSchema,
  type InviteAdminInput,
  memberListSchema,
  pendingInviteListSchema,
} from "@anar/domain/members";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MemberService } from "./service.js";

export type MemberRouteOptions = {
  members: MemberService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};
type SlugRequest = FastifyRequest<{ Params: { slug: string } }>;

const routes = {
  async register(
    app: FastifyInstance,
    { members, requireOrigin }: MemberRouteOptions,
  ): Promise<void> {
    const listed = apiSuccessSchema(memberListSchema);
    const entries = apiSuccessSchema(agencyEntryListSchema);
    const pending = apiSuccessSchema(pendingInviteListSchema);
    const invited = apiSuccessSchema(inviteResultSchema);
    const success = apiSuccessSchema(okSchema);
    const deactivated = apiSuccessSchema(deactivateMemberResultSchema);
    const onRequest = async (request: FastifyRequest) => {
      await requireOrigin(request);
    };
    app.get<{ Params: { slug: string } }>(
      "/api/companies/:slug/members/listMembers",
      async (request, reply) => {
        const actor = await routes._context(members, request);
        const items = await members.listMembers(actor);
        return reply.send(listed.parse({ ok: true, data: items }));
      },
    );
    app.get<{ Params: { slug: string } }>(
      "/api/companies/:slug/members/listAgencyEntries",
      async (request, reply) => {
        const actor = await routes._context(members, request);
        const items = await members.listAgencyEntries(actor);
        return reply.send(
          entries.parse({
            ok: true,
            data: items.map((entry) => ({
              ...entry,
              enteredAt: entry.enteredAt.toISOString(),
            })),
          }),
        );
      },
    );
    app.get<{ Params: { slug: string } }>(
      "/api/companies/:slug/members/listInvites",
      async (request, reply) => {
        const actor = await routes._context(members, request);
        const items = await members.listInvites(actor);
        return reply.send(
          pending.parse({
            ok: true,
            data: items.map((invite) => ({
              ...invite,
              expiresAt: invite.expiresAt.toISOString(),
            })),
          }),
        );
      },
    );
    app.post<{ Params: { slug: string }; Body: InviteAdminInput }>(
      "/api/companies/:slug/members/inviteAdmin",
      { onRequest },
      async (request, reply) => {
        const actor = await routes._context(members, request);
        const result = await members.inviteAdmin(actor, request.body, {
          ip: request.ip,
        });
        return reply.send(invited.parse({ ok: true, data: result }));
      },
    );
    app.post<{ Params: { slug: string }; Body: ResendInviteInput }>(
      "/api/companies/:slug/members/resendInvite",
      { onRequest },
      async (request, reply) => {
        const actor = await routes._context(members, request);
        const limit = await members.resendInvite(actor, request.body, {
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
    app.post<{ Params: { slug: string }; Body: DeactivateMemberInput }>(
      "/api/companies/:slug/members/deactivateMember",
      { onRequest },
      async (request, reply) => {
        const actor = await routes._context(members, request);
        const result = await members.deactivateMember(actor, request.body, {
          ip: request.ip,
        });
        return reply.send(deactivated.parse({ ok: true, data: result }));
      },
    );
  },

  async _context(members: MemberService, request: SlugRequest) {
    const slug = slugSchema.safeParse(request.params.slug);
    if (!slug.success || !emptySchema.safeParse(request.query).success)
      throw new AppError("validation", "A valid company slug is required");
    return members.requireContext(request, slug.data);
  },
};
export default routes;
