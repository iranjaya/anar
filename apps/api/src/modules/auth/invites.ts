import { createHash, createSecretKey, randomBytes } from "node:crypto";
import type { PlatformTx } from "@anar/db/platform";
import type {
  Agency,
  AgencyCompany,
  AgencyInviteView,
} from "@anar/domain/agencies";
import type { AuthUser } from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import type { PendingInvite } from "@anar/domain/members";
import { v7 } from "uuid";
import type { createMailCodec } from "../../lib/email/crypto.js";
import inviteEmail from "../../lib/email/templates/invite.js";
import { enqueue } from "../../lib/jobs/index.js";
import repository from "./inviteRepository.js";
import rateLimits, { type RateLimitResult } from "./rateLimits.js";

export type ReadInitialInviteAgency = (
  tx: PlatformTx,
  agencyId: string,
  ownerId: string,
) => Promise<{ name: string } | undefined>;
export type ReadStaffInviteAgency = (
  tx: PlatformTx,
  agencyId: string,
  issuerId: string,
) => Promise<{ name: string } | undefined>;
export type CompanyInviteTargetInput = {
  agencyId: string;
  companyId: string;
  issuerId: string;
  role: "super_admin" | "admin";
};
export type ReadCompanyInviteTarget = (
  tx: PlatformTx,
  input: CompanyInviteTargetInput,
) => Promise<{ agencyName: string; companyName: string } | undefined>;
export type InviteDeps = {
  publicOrigin: string;
  otpPepper: string;
  mailCodec: Pick<ReturnType<typeof createMailCodec>, "encryptMessage">;
  now(): Date;
};
type InviteRole = "agency_staff" | "super_admin" | "admin";
type InviteIssuer = { user: AuthUser; role?: string };
export type InviteService = {
  createCompanyInvite(
    tx: PlatformTx,
    actor: InviteIssuer,
    agency: Agency,
    company: AgencyCompany,
    input: { email: string; name: string; role: "super_admin" | "admin" },
  ): Promise<{ inviteId: string }>;
  resendCompanyInvite(
    tx: PlatformTx,
    actor: InviteIssuer,
    agency: Agency,
    company: AgencyCompany,
    input: { inviteId: string; roles: ("super_admin" | "admin")[] },
  ): Promise<{ inviteId: string } & RateLimitResult>;
  createInitialInvite(
    tx: PlatformTx,
    actor: { user: AuthUser },
    agency: Agency,
    input: { email: string; name: string },
  ): Promise<{ inviteId: string }>;
  resendInitialInvite(
    tx: PlatformTx,
    actor: { user: AuthUser },
    agency: Agency,
  ): Promise<{ inviteId: string } & RateLimitResult>;
  createStaffInvite(
    tx: PlatformTx,
    actor: { user: AuthUser },
    agency: Agency,
    input: { email: string; name: string },
  ): Promise<{ inviteId: string }>;
  resendStaffInvite(
    tx: PlatformTx,
    actor: { user: AuthUser },
    agency: Agency,
    inviteId: string,
  ): Promise<{ inviteId: string } & RateLimitResult>;
  revokeIssuerInvites(
    tx: PlatformTx,
    agencyId: string,
    issuerId: string,
  ): Promise<void>;
};

const invites = {
  create(deps: InviteDeps): InviteService {
    const bytes = Buffer.from(deps.otpPepper, "base64");
    if (bytes.length !== 32)
      throw new Error("OTP pepper must contain 32 bytes");
    const pepper = createSecretKey(bytes);
    const origin = new URL(deps.publicOrigin);
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.origin !== deps.publicOrigin
    ) {
      throw new Error("Invites require a configured HTTP or HTTPS origin");
    }
    return {
      async createCompanyInvite(tx, actor, agency, company, input) {
        await repository.revokeExpiredCompanyInvite(
          tx,
          company.id,
          input.email,
          deps.now(),
        );
        return invites._issue(
          tx,
          deps,
          actor,
          agency,
          { id: v7(), ...input },
          false,
          company,
        );
      },
      async resendCompanyInvite(tx, actor, agency, company, input) {
        const invite = await repository.lockCompanyInvite(
          tx,
          company.id,
          input.inviteId,
          input.roles,
        );
        if (!invite)
          throw new AppError("not_found", "Invitation is unavailable");
        const limit = await rateLimits.resendInvite(
          tx,
          invite.id,
          pepper,
          deps.now,
        );
        if (limit.allowed)
          await invites._issue(tx, deps, actor, agency, invite, true, company);
        return { inviteId: invite.id, ...limit };
      },
      async createInitialInvite(tx, actor, agency, input) {
        return invites._issue(
          tx,
          deps,
          actor,
          agency,
          { id: v7(), ...input, role: "agency_staff" },
          false,
        );
      },
      async resendInitialInvite(tx, actor, agency) {
        const invite = await repository.lockInitial(
          tx,
          agency.id,
          actor.user.id,
        );
        if (!invite)
          throw new AppError("not_found", "Invitation is unavailable");
        const limit = await rateLimits.resendInvite(
          tx,
          invite.id,
          pepper,
          deps.now,
        );
        if (limit.allowed)
          await invites._issue(tx, deps, actor, agency, invite, true);
        return { inviteId: invite.id, ...limit };
      },
      async createStaffInvite(tx, actor, agency, input) {
        await repository.revokeExpiredStaffInvite(
          tx,
          agency.id,
          input.email,
          deps.now(),
        );
        return invites._issue(
          tx,
          deps,
          actor,
          agency,
          { id: v7(), ...input, role: "agency_staff" },
          false,
        );
      },
      async resendStaffInvite(tx, actor, agency, inviteId) {
        const invite = await repository.lockStaffInvite(
          tx,
          agency.id,
          inviteId,
        );
        if (!invite)
          throw new AppError("not_found", "Invitation is unavailable");
        const limit = await rateLimits.resendInvite(
          tx,
          invite.id,
          pepper,
          deps.now,
        );
        if (limit.allowed)
          await invites._issue(tx, deps, actor, agency, invite, true);
        return { inviteId: invite.id, ...limit };
      },
      revokeIssuerInvites(tx, agencyId, issuerId) {
        return repository.revokeByIssuer(tx, agencyId, issuerId, deps.now());
      },
    };
  },

  async _issue(
    tx: PlatformTx,
    deps: InviteDeps,
    actor: InviteIssuer,
    agency: Agency,
    input: { id: string; email: string; name: string; role: InviteRole },
    resent: boolean,
    company: AgencyCompany | null = null,
  ): Promise<{ inviteId: string }> {
    const { id } = input;
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(deps.now().getTime() + 7 * 86400000);
    if (resent) await repository.replaceToken(tx, id, tokenHash, expiresAt);
    else {
      const inserted = await repository.insert(tx, {
        id,
        agencyId: agency.id,
        companyId: company?.id ?? null,
        email: input.email,
        name: input.name,
        role: input.role,
        tokenHash,
        expiresAt,
        createdBy: actor.user.id,
      });
      if (!inserted)
        throw new AppError("conflict", "An invitation is already pending");
    }
    const key = invites.deliveryKey(id, tokenHash);
    const message = inviteEmail.render({
      name: input.name,
      role: input.role,
      agency: agency.name,
      company: company?.name ?? null,
      inviter: { name: actor.user.name, role: invites._inviterRole(actor) },
      url: `${deps.publicOrigin}/invite#token=${token}`,
      expiresAt,
      timeZone: "Asia/Kathmandu",
      resent,
    });
    await enqueue(
      tx,
      "notify.email",
      {
        kind: "invite",
        referenceId: id,
        expiresAt: expiresAt.toISOString(),
        encryptedMessage: deps.mailCodec.encryptMessage(
          { to: input.email, ...message },
          key,
        ),
      },
      key,
    );
    return { inviteId: id };
  },

  async findDeliverable(
    tx: PlatformTx,
    id: string,
    at: Date,
    readAgency: ReadInitialInviteAgency,
    readStaffAgency: ReadStaffInviteAgency,
    readCompany: ReadCompanyInviteTarget,
  ) {
    const row = await repository.findDeliverable(tx, id, at);
    if (!row) return undefined;
    if (
      row.role === "agency_staff" &&
      row.companyId === null &&
      row.issuerRole === "owner"
    ) {
      if (!(await readAgency(tx, row.agencyId, row.createdBy)))
        return undefined;
    } else if (
      row.role === "agency_staff" &&
      row.companyId === null &&
      row.issuerRole === null
    ) {
      if (!(await readStaffAgency(tx, row.agencyId, row.createdBy)))
        return undefined;
    } else if (
      (row.role === "super_admin" || row.role === "admin") &&
      row.companyId !== null &&
      row.issuerRole === null
    ) {
      if (
        !(await readCompany(tx, {
          agencyId: row.agencyId,
          companyId: row.companyId,
          issuerId: row.createdBy,
          role: row.role,
        }))
      )
        return undefined;
    } else return undefined;
    return {
      email: row.email,
      expiresAt: row.expiresAt,
      key: invites.deliveryKey(row.id, row.tokenHash),
    };
  },

  listStaffInvites(
    tx: PlatformTx,
    agencyId: string,
    cursor?: { createdAt: Date; id: string },
  ): Promise<AgencyInviteView[]> {
    return repository.listStaffInvites(tx, agencyId, cursor);
  },

  _inviterRole(actor: InviteIssuer): "owner" | "agency_staff" | "super_admin" {
    if (actor.user.platformRole === "owner") return "owner";
    return actor.role === "super_admin" ? "super_admin" : "agency_staff";
  },

  revokeCompanyIssuerInvites(
    tx: PlatformTx,
    companyId: string,
    issuerId: string,
    at: Date,
  ): Promise<void> {
    return repository.revokeCompanyByIssuer(tx, companyId, issuerId, at);
  },

  listCompanyInvites(
    tx: PlatformTx,
    companyId: string,
  ): Promise<PendingInvite[]> {
    return repository.listCompanyInvites(tx, companyId);
  },

  deliveryKey(id: string, tokenHash: string): string {
    return `invite:${id}:${tokenHash}`;
  },
};

export default invites;
