import {
  type AgencyInvitePage,
  type AgencyListQuery,
  type AgencyStaffPage,
  type AgencyView,
  type DeactivateStaffInput,
  deactivateStaffSchema,
  type InviteStaffInput,
  inviteStaffSchema,
} from "@anar/domain/agencies";
import {
  type InviteResult,
  type ResendInviteInput,
  resendInviteSchema,
} from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import type { FastifyRequest } from "fastify";
import invites, { type InviteService } from "../auth/invites.js";
import profiles from "../auth/profiles.js";
import type { RateLimitResult } from "../auth/rateLimits.js";
import type { RequestMeta, SessionService } from "../auth/sessions.js";
import audit from "../tenant/audit.js";
import permissions from "../tenant/permissions.js";
import stepUp from "../tenant/stepUp.js";
import type context from "./context.js";
import pagination from "./pagination.js";
import repository from "./repository.js";
import type { AgencyCtx } from "./service.js";

export type StaffDeps = {
  context: ReturnType<typeof context.create>;
  now(): Date;
  createStaffInvite: InviteService["createStaffInvite"];
  resendStaffInvite: InviteService["resendStaffInvite"];
  revokeIssuerInvites: InviteService["revokeIssuerInvites"];
  revokeAllSessions: SessionService["revokeAllSessions"];
};
export type StaffService = {
  requireAgencyContext(
    request: Pick<FastifyRequest, "headers">,
  ): Promise<AgencyCtx>;
  getAgency(actor: AgencyCtx): Promise<AgencyView>;
  listStaff(actor: AgencyCtx, query: AgencyListQuery): Promise<AgencyStaffPage>;
  listStaffInvites(
    actor: AgencyCtx,
    query: AgencyListQuery,
  ): Promise<AgencyInvitePage>;
  inviteStaff(
    actor: AgencyCtx,
    input: InviteStaffInput,
    meta: RequestMeta,
  ): Promise<InviteResult>;
  resendStaffInvite(
    actor: AgencyCtx,
    input: ResendInviteInput,
    meta: RequestMeta,
  ): Promise<RateLimitResult>;
  deactivateStaff(
    actor: AgencyCtx,
    input: DeactivateStaffInput,
    meta: RequestMeta,
  ): Promise<void>;
};
const staff = {
  create(deps: StaffDeps): StaffService {
    const agencyContext = deps.context;
    return {
      requireAgencyContext: agencyContext.requireAgencyContext,
      getAgency(actor) {
        return agencyContext.withAgencyContext(actor, async (_tx, current) => ({
          agency: {
            id: current.agency.id,
            name: current.agency.name,
            slug: current.agency.slug,
            status: current.agency.status,
            createdAt: current.agency.createdAt,
          },
          staff: {
            ...current.staff,
            name: current.user.name,
            email: current.user.email,
          },
          capabilities: permissions.capabilities(current),
        }));
      },
      listStaff(actor, query) {
        const cursor = pagination.cursor(query);
        return agencyContext.withAgencyContext(actor, async (tx, current) => {
          permissions.require(current, "agency.staff.list");
          const page = pagination.page(
            await repository.listStaff(tx, current.agencyId, cursor),
          );
          const users = new Map(
            (
              await profiles.read(
                tx,
                page.items.map((member) => member.userId),
              )
            ).map((user) => [user.id, user]),
          );
          const items = page.items.map((member) => {
            const user = users.get(member.userId);
            if (!user)
              throw new AppError(
                "unavailable",
                "Staff identity is unavailable",
              );
            return { ...member, name: user.name, email: user.email };
          });
          return { items, nextCursor: page.nextCursor };
        });
      },
      listStaffInvites(actor, query) {
        const cursor = pagination.cursor(query);
        return agencyContext.withAgencyContext(actor, async (tx, current) => {
          permissions.require(current, "agency.staff.list");
          return pagination.page(
            await invites.listStaffInvites(tx, current.agencyId, cursor),
          );
        });
      },
      inviteStaff(actor, input, meta) {
        const parsed = inviteStaffSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError("validation", "Check the invitation details");
        return agencyContext.withAgencyContext(actor, async (tx, current) => {
          permissions.require(current, "agency.staff.invite");
          stepUp.requireFreshOtp(current, deps.now());
          const result = await deps.createStaffInvite(
            tx,
            current,
            current.agency,
            parsed.data,
          );
          await staff._audit(tx, current, meta, "agency.staff_invited", result);
          return result;
        });
      },
      resendStaffInvite(actor, input, meta) {
        const parsed = resendInviteSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError("validation", "A valid invitation is required");
        return agencyContext.withAgencyContext(actor, async (tx, current) => {
          permissions.require(current, "agency.staff.resend");
          stepUp.requireFreshOtp(current, deps.now());
          const { inviteId, allowed, retryAfter } =
            await deps.resendStaffInvite(
              tx,
              current,
              current.agency,
              parsed.data.inviteId,
            );
          if (allowed)
            await staff._audit(
              tx,
              current,
              meta,
              "agency.staff_invite_resent",
              {
                inviteId,
              },
            );
          return { allowed, retryAfter };
        });
      },
      async deactivateStaff(actor, input, meta) {
        const parsed = deactivateStaffSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError("validation", "Choose a staff member to remove");
        const target = await agencyContext.withAgencyContext(
          actor,
          (tx, current) =>
            repository.readStaffById(tx, current.agencyId, parsed.data.staffId),
        );
        if (!target)
          throw new AppError("not_found", "Staff member is unavailable");
        await agencyContext.withAgencyContext(
          actor,
          async (tx, current) => {
            permissions.require(current, "agency.staff.deactivate");
            stepUp.requireFreshOtp(current, deps.now());
            const member = await repository.lockStaffById(
              tx,
              current.agencyId,
              target.id,
            );
            if (!member || member.userId !== target.userId)
              throw new AppError("not_found", "Staff member is unavailable");
            if (member.status !== "active") return;
            if (
              (await repository.countOtherActiveStaff(
                tx,
                current.agencyId,
                member.userId,
              )) === 0
            )
              throw new AppError(
                "conflict",
                "The last active staff member cannot be removed",
              );
            await repository.deactivateStaff(tx, member.id, deps.now());
            await deps.revokeAllSessions(tx, member.userId);
            await deps.revokeIssuerInvites(tx, current.agencyId, member.userId);
            await audit.audit(
              tx,
              {
                user: current.user,
                role: current.role,
                agencyId: current.agencyId,
                companyId: null,
                ip: meta.ip,
              },
              "agency.staff_deactivated",
              { type: "agency_member", id: member.id },
              { userId: member.userId },
            );
          },
          [target.userId],
        );
      },
    };
  },

  _audit(
    tx: Parameters<typeof audit.audit>[0],
    current: AgencyCtx,
    meta: RequestMeta,
    action: "agency.staff_invited" | "agency.staff_invite_resent",
    data: InviteResult,
  ) {
    return audit.audit(
      tx,
      {
        user: current.user,
        role: current.role,
        agencyId: current.agencyId,
        companyId: null,
        ip: meta.ip,
      },
      action,
      { type: "invite", id: data.inviteId },
      data,
    );
  },
};
export default staff;
