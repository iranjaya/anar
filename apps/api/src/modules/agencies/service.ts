import {
  type PlatformTx,
  withPlatformAgency,
  withPlatformIdentity,
} from "@anar/db/platform";
import {
  type Agency,
  type AgencyListQuery,
  type AgencyMember,
  type AgencyPage,
  type CreateAgencyInput,
  type CreateAgencyResult,
  createAgencySchema,
  type ResendFirstInviteInput,
  resendFirstInviteSchema,
} from "@anar/domain/agencies";
import { AppError } from "@anar/domain/errors";
import type { FastifyRequest } from "fastify";
import { v7 } from "uuid";
import type { InviteService } from "../auth/invites.js";
import type { RateLimitResult } from "../auth/rateLimits.js";
import type {
  AuthSession,
  RequestMeta,
  SessionService,
} from "../auth/sessions.js";
import audit from "../tenant/audit.js";
import permissions from "../tenant/permissions.js";
import stepUp from "../tenant/stepUp.js";
import pagination from "./pagination.js";
import repository from "./repository.js";

export type OwnerCtx = AuthSession & { role: "owner" };
export type AgencyCtx = AuthSession & {
  role: "agency_staff";
  agency: Agency;
  agencyId: string;
  staff: AgencyMember;
};
export type AgencyDeps = {
  sessions: Pick<SessionService, "requireSession" | "withPlatformSession">;
  createInitialInvite: InviteService["createInitialInvite"];
  resendInitialInvite: InviteService["resendInitialInvite"];
  now(): Date;
};
export type AgencyService = {
  requireOwner(request: Pick<FastifyRequest, "headers">): Promise<OwnerCtx>;
  createAgency(
    actor: OwnerCtx,
    input: CreateAgencyInput,
    meta: RequestMeta,
  ): Promise<CreateAgencyResult>;
  listAgencies(actor: OwnerCtx, query: AgencyListQuery): Promise<AgencyPage>;
  resendFirstInvite(
    actor: OwnerCtx,
    input: ResendFirstInviteInput,
    meta: RequestMeta,
  ): Promise<RateLimitResult>;
};

const agencies = {
  create(deps: AgencyDeps): AgencyService {
    return {
      async requireOwner(request) {
        return agencies._owner(await deps.sessions.requireSession(request));
      },

      async createAgency(actor, input, meta) {
        const parsed = createAgencySchema.safeParse(input);
        if (!parsed.success)
          throw new AppError(
            "validation",
            "Check the agency and first staff details",
          );
        return deps.sessions.withPlatformSession(actor, async (tx, current) => {
          const owner = agencies._owner(current);
          permissions.require(owner, "agency.create");
          const at = deps.now();
          stepUp.requireFreshOtp(owner, at);
          const agency = await repository.create(tx, {
            id: v7(),
            name: parsed.data.name,
            slug: parsed.data.slug,
            status: "pending",
            createdBy: owner.user.id,
            createdAt: at,
            updatedAt: at,
          });
          if (!agency)
            throw new AppError("conflict", "Agency slug is unavailable");
          const invite = await deps.createInitialInvite(tx, owner, agency, {
            email: parsed.data.email,
            name: parsed.data.staffName,
          });
          await audit.audit(
            tx,
            {
              user: owner.user,
              role: "owner",
              agencyId: agency.id,
              companyId: null,
              ip: meta.ip,
            },
            "agency.created",
            { type: "agency", id: agency.id },
            { inviteId: invite.inviteId },
          );
          return { agencyId: agency.id, inviteId: invite.inviteId };
        });
      },

      async resendFirstInvite(actor, input, meta) {
        const parsed = resendFirstInviteSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError("validation", "A valid agency is required");
        return deps.sessions.withPlatformSession(actor, async (tx, current) => {
          const owner = agencies._owner(current);
          permissions.require(owner, "agency.resend_first_invite");
          stepUp.requireFreshOtp(owner, deps.now());
          const agency = await agencies.lockInitialInviteAgency(
            tx,
            parsed.data.agencyId,
            owner.user.id,
          );
          if (!agency)
            throw new AppError("not_found", "Invitation is unavailable");
          const result = await deps.resendInitialInvite(tx, owner, agency);
          const { inviteId, allowed, retryAfter } = result;
          if (!allowed) return { allowed, retryAfter };
          await audit.audit(
            tx,
            {
              user: owner.user,
              role: "owner",
              agencyId: agency.id,
              companyId: null,
              ip: meta.ip,
            },
            "agency.first_invite_resent",
            { type: "invite", id: inviteId },
            { inviteId },
          );
          return { allowed, retryAfter };
        });
      },

      async listAgencies(actor, query) {
        const cursor = pagination.cursor(query);
        return deps.sessions.withPlatformSession(actor, async (tx, current) => {
          permissions.require(agencies._owner(current), "agency.list");
          const rows = await repository.list(tx, cursor);
          return pagination.page(rows);
        });
      },
    };
  },

  readInitialInviteAgency(tx: PlatformTx, agencyId: string, ownerId: string) {
    return repository.readInitialInviteAgency(tx, agencyId, ownerId);
  },
  async readActiveAgency(
    tx: PlatformTx,
    agencyId: string,
    lock = false,
  ): Promise<Agency | undefined> {
    const agency = lock
      ? await repository.lockAgency(tx, agencyId)
      : await repository.readAgency(tx, agencyId);
    return agency?.status === "active" ? agency : undefined;
  },
  hasActiveStaff(
    tx: PlatformTx,
    agencyId: string,
    userId: string,
    lock = false,
  ): Promise<boolean> {
    return withPlatformAgency(tx, { agencyId, userId }, async (scoped) => {
      const staff = lock
        ? await repository.lockStaff(scoped, agencyId, userId)
        : await repository.readOwnStaff(scoped, userId);
      return staff?.agencyId === agencyId && staff.status === "active";
    });
  },

  readStaffInviteAgency(tx: PlatformTx, agencyId: string, issuerId: string) {
    return agencies._staffInviteAgency(tx, agencyId, issuerId, false);
  },
  lockStaffInviteAgency(tx: PlatformTx, agencyId: string, issuerId: string) {
    return agencies._staffInviteAgency(tx, agencyId, issuerId, true);
  },
  async _staffInviteAgency(
    tx: PlatformTx,
    agencyId: string,
    issuerId: string,
    lock: boolean,
  ): Promise<Agency | undefined> {
    const agency = await agencies.readActiveAgency(tx, agencyId, lock);
    if (
      !agency ||
      !(await agencies.hasActiveStaff(tx, agencyId, issuerId, lock))
    )
      return undefined;
    return agency;
  },

  async lockInitialInviteAgency(
    tx: PlatformTx,
    agencyId: string,
    ownerId: string,
  ): Promise<Agency | undefined> {
    const agency = await repository.lockAgency(tx, agencyId);
    if (agency?.status !== "pending" || agency.createdBy !== ownerId)
      return undefined;
    return agency;
  },

  async isActiveStaffInScope(
    tx: PlatformTx,
    agencyId: string,
    userId: string,
  ): Promise<boolean> {
    const staff = await repository.readOwnStaff(tx, userId);
    return staff?.agencyId === agencyId && staff.status === "active";
  },

  async hasStaffMembership(tx: PlatformTx, userId: string): Promise<boolean> {
    return Boolean(await agencies.readStaffMembership(tx, userId));
  },
  readStaffMembership(
    tx: PlatformTx,
    userId: string,
  ): Promise<AgencyMember | undefined> {
    return withPlatformIdentity(tx, userId, (scoped) =>
      repository.readOwnStaff(scoped, userId),
    );
  },

  async activateInvitedStaff(
    tx: PlatformTx,
    input: {
      agencyId: string;
      userId: string;
      invitedBy: string;
      initial: boolean;
      at: Date;
    },
  ): Promise<AgencyMember> {
    return withPlatformAgency(
      tx,
      { agencyId: input.agencyId, userId: input.userId },
      async (scoped) => {
        const staff = await repository.insertStaff(scoped, {
          id: v7(),
          agencyId: input.agencyId,
          userId: input.userId,
          status: "active",
          invitedBy: input.invitedBy,
          createdAt: input.at,
          updatedAt: input.at,
        });
        if (!staff)
          throw new AppError(
            "conflict",
            "Invite cannot be accepted by this account",
          );
        if (
          input.initial &&
          !(await repository.activateAgency(
            scoped,
            input.agencyId,
            input.invitedBy,
            input.at,
          ))
        ) {
          throw new AppError("not_found", "Invitation is unavailable");
        }
        return staff;
      },
    );
  },

  _owner(actor: AuthSession): OwnerCtx {
    if (actor.user.platformRole !== "owner")
      throw new AppError("forbidden", "Owner access is required");
    return { ...actor, role: "owner" };
  },
};

export default agencies;
