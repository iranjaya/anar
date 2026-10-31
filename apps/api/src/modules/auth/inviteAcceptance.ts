import { createHash, createSecretKey } from "node:crypto";
import {
  createPlatformDb,
  type invites as inviteTable,
  type PlatformDb,
  type PlatformTx,
  withPlatformIdentity,
  withPlatformTenant,
} from "@anar/db/platform";
import type { Agency, AgencyMember } from "@anar/domain/agencies";
import {
  type AcceptInviteInput,
  type AcceptInviteResult,
  type AuthUser,
  acceptInviteSchema,
  type InviteTokenInput,
  type InviteView,
  inviteTokenSchema,
} from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import type {
  ActivateInvitedMemberInput,
  CompanyMember,
} from "@anar/domain/members";
import { v7 } from "uuid";
import audit from "../tenant/audit.js";
import repository from "./inviteRepository.js";
import type {
  ReadCompanyInviteTarget,
  ReadInitialInviteAgency,
  ReadStaffInviteAgency,
} from "./invites.js";
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
  readStaffInviteAgency: ReadStaffInviteAgency;
  lockStaffInviteAgency: ReadStaffInviteAgency;
  readCompanyInviteTarget: ReadCompanyInviteTarget;
  lockCompanyInviteTarget: ReadCompanyInviteTarget;
  activateInvitedMember(
    tx: PlatformTx,
    input: ActivateInvitedMemberInput,
  ): Promise<CompanyMember>;
  lockInitialInviteAgency(
    tx: PlatformTx,
    agencyId: string,
    ownerId: string,
  ): Promise<Agency | undefined>;
  hasStaffMembership(tx: PlatformTx, userId: string): Promise<boolean>;
  hasCompanyMembership(tx: PlatformTx, userId: string): Promise<boolean>;
  activateInvitedStaff(
    tx: PlatformTx,
    input: {
      agencyId: string;
      userId: string;
      invitedBy: string;
      initial: boolean;
      at: Date;
    },
  ): Promise<AgencyMember>;
};
type Issuer = "owner" | "staff";
export type InviteAcceptanceService = {
  admit(operation: InviteOperation, ip: string): Promise<RateLimitResult>;
  inspectInvite(input: InviteTokenInput): Promise<InviteView>;
  acceptInvite(
    input: AcceptInviteInput,
    meta: RequestMeta,
  ): Promise<AcceptInviteResult>;
};
type StoredInvite = typeof inviteTable.$inferSelect;
type ValidInvite = Omit<StoredInvite, "role" | "companyId"> &
  (
    | { role: "agency_staff"; companyId: null }
    | { role: "super_admin" | "admin"; companyId: string }
  );

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
          const issuer = inviteAcceptance._issuer(
            invite,
            await identities.readUser(tx, invite.createdBy),
          );
          const target = await inviteAcceptance._target(
            deps,
            tx,
            invite,
            issuer,
            false,
          );
          return {
            kind:
              invite.role === "agency_staff"
                ? "agency_staff"
                : "company_member",
            email: invite.email,
            name: invite.name,
            ...target,
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
          const issuer = inviteAcceptance._issuer(
            candidate,
            users.find((row) => row.id === candidate.createdBy),
          );
          const user = users.find((row) => row.id === recipient.id);
          if (
            !user ||
            user.email.toLowerCase() !== candidate.email.toLowerCase() ||
            user.platformRole !== null ||
            user.deactivatedAt !== null ||
            (await deps.hasStaffMembership(tx, user.id)) ||
            (candidate.role === "agency_staff" &&
              (await withPlatformIdentity(tx, user.id, (scoped) =>
                deps.hasCompanyMembership(scoped, user.id),
              )))
          ) {
            throw new AppError(
              "conflict",
              "Invite cannot be accepted by this account",
            );
          }
          await inviteAcceptance._target(deps, tx, candidate, issuer, true);
          const locked = await repository.lock(tx, candidate.id);
          const at = deps.now();
          const invite = inviteAcceptance._valid(locked, tokenHash, at);
          if (
            invite.agencyId !== candidate.agencyId ||
            invite.companyId !== candidate.companyId ||
            invite.role !== candidate.role ||
            invite.createdBy !== candidate.createdBy ||
            invite.email.toLowerCase() !== user.email.toLowerCase()
          ) {
            throw new AppError("not_found", "Invitation is unavailable");
          }
          const member =
            invite.role === "agency_staff"
              ? await deps.activateInvitedStaff(tx, {
                  agencyId: invite.agencyId,
                  userId: user.id,
                  invitedBy: invite.createdBy,
                  initial: issuer === "owner",
                  at,
                })
              : await withPlatformTenant(
                  tx,
                  {
                    agencyId: invite.agencyId,
                    companyId: invite.companyId,
                    userId: user.id,
                  },
                  (scoped) =>
                    deps.activateInvitedMember(scoped, {
                      agencyId: invite.agencyId,
                      companyId: invite.companyId,
                      userId: user.id,
                      name: user.name,
                      role: invite.role,
                      at,
                    }),
                );
          await repository.consume(tx, invite.id, at);
          const actor = {
            user,
            role: invite.role,
            agencyId: invite.agencyId,
            companyId: invite.companyId,
            ip: meta.ip,
          };
          const data = { inviteId: invite.id, inviterId: invite.createdBy };
          if (invite.role === "agency_staff") {
            await audit.audit(
              tx,
              actor,
              "agency.staff_accepted",
              { type: "agency_member", id: member.id },
              data,
            );
          } else {
            await audit.audit(
              tx,
              actor,
              "company.member_accepted",
              { type: "company_member", id: member.id },
              data,
            );
          }
          return { userId: user.id };
        });
      },
    };
  },

  _issuer(invite: ValidInvite, issuer: AuthUser | undefined): Issuer {
    if (!issuer || issuer.deactivatedAt !== null)
      throw new AppError("not_found", "Invitation is unavailable");
    if (invite.role === "agency_staff" && issuer.platformRole === "owner")
      return "owner";
    if (issuer.platformRole === null) return "staff";
    throw new AppError("not_found", "Invitation is unavailable");
  },

  async _target(
    deps: InviteAcceptanceDeps,
    tx: PlatformTx,
    invite: ValidInvite,
    issuer: Issuer,
    lock: boolean,
  ) {
    if (invite.role === "agency_staff") {
      const initial = lock
        ? deps.lockInitialInviteAgency
        : deps.readInitialInviteAgency;
      const staff = lock
        ? deps.lockStaffInviteAgency
        : deps.readStaffInviteAgency;
      const read = issuer === "owner" ? initial : staff;
      const agency = await read(tx, invite.agencyId, invite.createdBy);
      if (!agency) throw new AppError("not_found", "Invitation is unavailable");
      return { agencyName: agency.name, companyName: null };
    }
    const read = lock
      ? deps.lockCompanyInviteTarget
      : deps.readCompanyInviteTarget;
    const target = await read(tx, {
      agencyId: invite.agencyId,
      companyId: invite.companyId,
      issuerId: invite.createdBy,
      role: invite.role,
    });
    if (!target) throw new AppError("not_found", "Invitation is unavailable");
    return target;
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
    invite: StoredInvite | undefined,
    tokenHash: string,
    at: Date,
  ): ValidInvite {
    if (
      !invite ||
      invite.tokenHash !== tokenHash ||
      invite.acceptedAt !== null ||
      invite.revokedAt !== null ||
      at.getTime() >= invite.expiresAt.getTime()
    ) {
      throw new AppError("not_found", "Invitation is unavailable");
    }
    if (invite.role === "agency_staff" && invite.companyId === null)
      return { ...invite, role: invite.role, companyId: invite.companyId };
    if (
      (invite.role === "super_admin" || invite.role === "admin") &&
      invite.companyId !== null
    )
      return { ...invite, role: invite.role, companyId: invite.companyId };
    throw new AppError("not_found", "Invitation is unavailable");
  },
};

export default inviteAcceptance;
