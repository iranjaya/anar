import { createHash, createSecretKey } from "node:crypto";
import {
  createPlatformDb,
  type invites as inviteTable,
  type PlatformDb,
  type PlatformTx,
} from "@anar/db/platform";
import type { Agency, AgencyMember } from "@anar/domain/agencies";
import {
  type AcceptInviteInput,
  type AcceptInviteResult,
  acceptInviteSchema,
  type InviteTokenInput,
  type InviteView,
  inviteTokenSchema,
} from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { v7 } from "uuid";
import audit from "../tenant/audit.js";
import repository from "./inviteRepository.js";
import type { ReadInitialInviteAgency } from "./invites.js";
import rateLimits, {
  type InviteOperation,
  type RateLimitResult,
} from "./rateLimits.js";
import identities from "./repository.js";
import type { RequestMeta } from "./sessions.js";

export type InviteAcceptanceDeps = {
  db: PlatformDb;
  otpPepper: string;
  now(): Date;
  readInitialInviteAgency: ReadInitialInviteAgency;
  lockInitialInviteAgency(
    tx: PlatformTx,
    agencyId: string,
    ownerId: string,
  ): Promise<Agency | undefined>;
  hasStaffMembership(tx: PlatformTx, userId: string): Promise<boolean>;
  activateInvitedStaff(
    tx: PlatformTx,
    input: { agencyId: string; userId: string; invitedBy: string; at: Date },
  ): Promise<AgencyMember>;
};
export type InviteAcceptanceService = {
  admit(operation: InviteOperation, ip: string): Promise<RateLimitResult>;
  inspectInvite(input: InviteTokenInput): Promise<InviteView>;
  acceptInvite(
    input: AcceptInviteInput,
    meta: RequestMeta,
  ): Promise<AcceptInviteResult>;
};

const inviteAcceptance = {
  create(deps: InviteAcceptanceDeps): InviteAcceptanceService {
    const bytes = Buffer.from(deps.otpPepper, "base64");
    if (bytes.length !== 32)
      throw new Error("OTP pepper must contain 32 bytes");
    const pepper = createSecretKey(bytes);
    return {
      admit(operation, ip) {
        return deps.db.transaction((tx) =>
          rateLimits.invite(tx, operation, ip, pepper, deps.now),
        );
      },

      async inspectInvite(input) {
        const parsed = inviteTokenSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError(
            "validation",
            "A valid invitation token is required",
          );
        const tokenHash = createHash("sha256")
          .update(parsed.data.token)
          .digest("hex");
        return deps.db.transaction(async (tx) => {
          const invite = inviteAcceptance._valid(
            await repository.readByHash(tx, tokenHash),
            tokenHash,
            deps.now(),
          );
          const issuer = await identities.readUser(tx, invite.createdBy);
          if (
            issuer?.platformRole !== "owner" ||
            issuer.deactivatedAt !== null
          ) {
            throw new AppError("not_found", "Invitation is unavailable");
          }
          const agency = await deps.readInitialInviteAgency(
            tx,
            invite.agencyId,
            invite.createdBy,
          );
          if (!agency)
            throw new AppError("not_found", "Invitation is unavailable");
          return {
            kind: "agency_staff",
            email: invite.email,
            name: invite.name,
            agencyName: agency.name,
            companyName: null,
            expiresAt: invite.expiresAt,
          };
        });
      },

      async acceptInvite(input, meta) {
        const parsed = acceptInviteSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError(
            "validation",
            "A valid invitation token and name are required",
          );
        const tokenHash = createHash("sha256")
          .update(parsed.data.token)
          .digest("hex");
        return deps.db.transaction(async (tx) => {
          const candidate = inviteAcceptance._valid(
            await repository.readByHash(tx, tokenHash),
            tokenHash,
            deps.now(),
          );
          const recipient = await identities.ensureInviteUser(tx, {
            id: v7(),
            email: candidate.email,
            name: parsed.data.name,
          });
          const users = await identities.lockUsers(tx, [
            candidate.createdBy,
            recipient.id,
          ]);
          const issuer = users.find((row) => row.id === candidate.createdBy);
          const user = users.find((row) => row.id === recipient.id);
          if (
            issuer?.platformRole !== "owner" ||
            issuer.deactivatedAt !== null
          ) {
            throw new AppError("not_found", "Invitation is unavailable");
          }
          if (
            !user ||
            user.email.toLowerCase() !== candidate.email.toLowerCase() ||
            user.platformRole !== null ||
            user.deactivatedAt !== null ||
            (await deps.hasStaffMembership(tx, user.id))
          ) {
            throw new AppError(
              "conflict",
              "Invite cannot be accepted by this account",
            );
          }
          const agency = await deps.lockInitialInviteAgency(
            tx,
            candidate.agencyId,
            issuer.id,
          );
          if (!agency)
            throw new AppError("not_found", "Invitation is unavailable");
          const locked = await repository.lock(tx, candidate.id);
          const at = deps.now();
          const invite = inviteAcceptance._valid(locked, tokenHash, at);
          if (
            invite.agencyId !== agency.id ||
            invite.createdBy !== issuer.id ||
            invite.email.toLowerCase() !== user.email.toLowerCase()
          ) {
            throw new AppError("not_found", "Invitation is unavailable");
          }
          const staff = await deps.activateInvitedStaff(tx, {
            agencyId: agency.id,
            userId: user.id,
            invitedBy: issuer.id,
            at,
          });
          await repository.consume(tx, invite.id, at);
          await audit.audit(
            tx,
            {
              user,
              role: "agency_staff",
              agencyId: agency.id,
              companyId: null,
              ip: meta.ip,
            },
            "agency.staff_accepted",
            { type: "agency_member", id: staff.id },
            { inviteId: invite.id, inviterId: issuer.id },
          );
          return { userId: user.id };
        });
      },
    };
  },

  async start(
    options: Omit<InviteAcceptanceDeps, "db"> & { connectionString: string },
  ) {
    const db = await createPlatformDb(options.connectionString);
    try {
      return {
        service: inviteAcceptance.create({ ...options, db }),
        close: db.close,
      };
    } catch (error) {
      await db.close();
      throw error;
    }
  },

  _valid(
    invite: typeof inviteTable.$inferSelect | undefined,
    tokenHash: string,
    at: Date,
  ) {
    if (
      !invite ||
      invite.tokenHash !== tokenHash ||
      invite.role !== "agency_staff" ||
      invite.companyId !== null ||
      invite.acceptedAt !== null ||
      invite.revokedAt !== null ||
      at.getTime() >= invite.expiresAt.getTime()
    ) {
      throw new AppError("not_found", "Invitation is unavailable");
    }
    return invite;
  },
};

export default inviteAcceptance;
