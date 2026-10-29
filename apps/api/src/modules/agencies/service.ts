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
  agencyCursorSchema,
  agencyListQuerySchema,
  type CreateAgencyInput,
  type CreateAgencyResult,
  createAgencySchema,
} from "@anar/domain/agencies";
import { AppError } from "@anar/domain/errors";
import type { FastifyRequest } from "fastify";
import { v7 } from "uuid";
import type { InviteService } from "../auth/invites.js";
import type {
  AuthSession,
  RequestMeta,
  SessionService,
} from "../auth/sessions.js";
import audit from "../tenant/audit.js";
import stepUp from "../tenant/stepUp.js";
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

      async listAgencies(actor, query) {
        const parsed = agencyListQuerySchema.safeParse(query);
        if (!parsed.success)
          throw new AppError("validation", "Invalid agency cursor");
        const cursor = parsed.data.cursor
          ? agencies._cursor(parsed.data.cursor)
          : undefined;
        return deps.sessions.withPlatformSession(actor, async (tx, current) => {
          agencies._owner(current);
          const rows = await repository.list(tx, cursor);
          const items = rows.slice(0, 50);
          const last = items.at(-1);
          const nextCursor =
            rows.length > 50 && last
              ? Buffer.from(
                  JSON.stringify({
                    createdAt: last.createdAt.toISOString(),
                    id: last.id,
                  }),
                ).toString("base64url")
              : null;
          return { items, nextCursor };
        });
      },
    };
  },

  readInitialInviteAgency(tx: PlatformTx, agencyId: string, ownerId: string) {
    return repository.readInitialInviteAgency(tx, agencyId, ownerId);
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

  async hasStaffMembership(tx: PlatformTx, userId: string): Promise<boolean> {
    return withPlatformIdentity(tx, userId, async (scoped) =>
      Boolean(await repository.readOwnStaff(scoped, userId)),
    );
  },

  async activateInvitedStaff(
    tx: PlatformTx,
    input: { agencyId: string; userId: string; invitedBy: string; at: Date },
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

  _cursor(encoded: string): { createdAt: Date; id: string } {
    try {
      const cursor = agencyCursorSchema.parse(
        JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
      );
      return { createdAt: new Date(cursor.createdAt), id: cursor.id };
    } catch {
      throw new AppError("validation", "Invalid agency cursor");
    }
  },
};

export default agencies;
