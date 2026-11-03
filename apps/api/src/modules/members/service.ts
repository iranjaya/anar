import { readCompanyScope, type TenantTx } from "@anar/db/tenant";
import {
  type InviteResult,
  type ResendInviteInput,
  resendInviteSchema,
} from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import {
  type ActivateInvitedMemberInput,
  type AgencyEntry,
  type CompanyMember,
  type DeactivateMemberInput,
  type DeactivateMemberResult,
  deactivateMemberSchema,
  type InviteAdminInput,
  inviteAdminSchema,
  type MemberView,
  type PendingInvite,
} from "@anar/domain/members";
import type { FastifyRequest } from "fastify";
import { v7 } from "uuid";
import invites, { type InviteService } from "../auth/invites.js";
import profiles from "../auth/profiles.js";
import type { RateLimitResult } from "../auth/rateLimits.js";
import sessions, { type RequestMeta } from "../auth/sessions.js";
import audit from "../tenant/audit.js";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import stepUp from "../tenant/stepUp.js";
import repository from "./repository.js";

export type MemberDeps = {
  context: Pick<
    ReturnType<typeof tenant.create>,
    "requireContext" | "withContext"
  >;
  now(): Date;
  createCompanyInvite: InviteService["createCompanyInvite"];
  resendCompanyInvite: InviteService["resendCompanyInvite"];
  getMemberLeadCounts(
    tx: TenantTx,
    memberId: string,
    at: Date,
  ): Promise<{ openLeads: number; overdue: number }>;
  reassignOpenLeads(
    tx: TenantTx,
    current: Ctx,
    from: string,
    to: string | null,
    meta: { at: Date; ip: string | null },
  ): Promise<number>;
};
export type MemberService = {
  requireContext(
    request: Pick<FastifyRequest, "headers">,
    slug: string,
  ): Promise<Ctx>;
  listMembers(actor: Ctx): Promise<MemberView[]>;
  listInvites(actor: Ctx): Promise<PendingInvite[]>;
  listAgencyEntries(actor: Ctx): Promise<AgencyEntry[]>;
  inviteAdmin(
    actor: Ctx,
    input: InviteAdminInput,
    meta: RequestMeta,
  ): Promise<InviteResult>;
  resendInvite(
    actor: Ctx,
    input: ResendInviteInput,
    meta: RequestMeta,
  ): Promise<RateLimitResult>;
  deactivateMember(
    actor: Ctx,
    input: DeactivateMemberInput,
    meta: RequestMeta,
  ): Promise<DeactivateMemberResult>;
};

const members = {
  create(deps: MemberDeps): MemberService {
    return {
      requireContext: deps.context.requireContext,
      listAgencyEntries(actor) {
        return deps.context.withContext(actor, async (tx, current) => {
          permissions.require(current, "members.list");
          const entries = await audit.listCompanyEntries(tx, current.companyId);
          const names = new Map(
            (
              await profiles.read(tx, [
                ...new Set(entries.map((entry) => entry.actorUserId)),
              ])
            ).map((user) => [user.id, user.name]),
          );
          return entries.map((entry) => ({
            id: entry.id,
            staffName: names.get(entry.actorUserId) ?? "",
            reason: entry.reason,
            enteredAt: entry.enteredAt,
          }));
        });
      },
      listMembers(actor) {
        return deps.context.withContext(actor, async (tx, current) => {
          permissions.require(current, "members.list");
          const rows = await repository.listCompany(tx, current.companyId);
          const users = new Map(
            (
              await profiles.read(
                tx,
                rows.map((row) => row.userId),
              )
            ).map((user) => [user.id, user]),
          );
          const at = deps.now();
          const views: MemberView[] = [];
          for (const row of rows) {
            const user = users.get(row.userId);
            if (!user)
              throw new AppError(
                "unavailable",
                "Member identity is unavailable",
              );
            views.push({
              id: row.id,
              companyId: row.companyId,
              userId: row.userId,
              name: row.name,
              role: row.role,
              status: row.status,
              email: user.email,
              ...(await deps.getMemberLeadCounts(tx, row.id, at)),
            });
          }
          return views;
        });
      },
      listInvites(actor) {
        return deps.context.withContext(actor, async (tx, current) => {
          permissions.require(current, "members.list");
          return invites.listCompanyInvites(tx, current.companyId);
        });
      },
      inviteAdmin(actor, input, meta) {
        const parsed = inviteAdminSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError("validation", "Check the invitation details");
        return deps.context.withContext(actor, async (tx, current) => {
          permissions.require(current, "members.invite_admin");
          stepUp.requireFreshOtp(current, deps.now());
          const result = await deps.createCompanyInvite(
            tx,
            current,
            current.agency,
            current.company,
            { ...parsed.data, role: "admin" },
          );
          await members._audit(
            tx,
            current,
            meta,
            "company.admin_invited",
            result,
          );
          return result;
        });
      },
      resendInvite(actor, input, meta) {
        const parsed = resendInviteSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError("validation", "A valid invitation is required");
        return deps.context.withContext(actor, async (tx, current) => {
          permissions.require(current, "members.invite_admin");
          stepUp.requireFreshOtp(current, deps.now());
          const { inviteId, allowed, retryAfter } =
            await deps.resendCompanyInvite(
              tx,
              current,
              current.agency,
              current.company,
              {
                inviteId: parsed.data.inviteId,
                roles:
                  current.role === "agency_staff"
                    ? ["super_admin", "admin"]
                    : ["admin"],
              },
            );
          if (allowed)
            await members._audit(tx, current, meta, "company.invite_resent", {
              inviteId,
            });
          return { allowed, retryAfter };
        });
      },
      async deactivateMember(actor, input, meta) {
        const parsed = deactivateMemberSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError("validation", "Choose a member to remove");
        const { memberId, reassignTo } = parsed.data;
        if (reassignTo === memberId)
          throw new AppError("validation", "Choose another member");
        const { found, destination, managers } = await deps.context.withContext(
          actor,
          async (tx, current) => {
            const member = await repository.read(
              tx,
              current.companyId,
              memberId,
            );
            return {
              found: member,
              destination: reassignTo
                ? await repository.read(tx, current.companyId, reassignTo)
                : null,
              managers:
                member?.role === "super_admin"
                  ? await repository.activeSuperAdminUserIds(
                      tx,
                      current.companyId,
                    )
                  : [],
            };
          },
        );
        if (!found) throw new AppError("not_found", "Member is unavailable");
        if (reassignTo && !destination)
          throw new AppError("validation", "Choose an active member");
        return deps.context.withContext(
          actor,
          async (tx, current) => {
            const resource = {
              agencyId: current.agencyId,
              companyId: current.companyId,
            };
            permissions.require(current, "members.deactivate", resource);
            const at = deps.now();
            stepUp.requireFreshOtp(current, at);
            const target = await repository.read(
              tx,
              current.companyId,
              memberId,
              true,
            );
            if (!target || target.userId !== found.userId)
              throw new AppError("not_found", "Member is unavailable");
            if (target.role === "super_admin") {
              if (current.role === "super_admin")
                throw new AppError(
                  "forbidden",
                  "A Super Admin cannot remove a Super Admin",
                );
              const others = (
                await repository.activeSuperAdminUserIds(tx, current.companyId)
              ).filter((userId) => userId !== target.userId);
              if (
                target.status === "active" &&
                (await profiles.countUsable(tx, others)) === 0
              )
                throw new AppError(
                  "conflict",
                  "The last Super Admin cannot be removed",
                );
            }
            if (target.status !== "active") return { reassigned: 0 };
            if (destination) {
              const locked = await repository.read(
                tx,
                current.companyId,
                destination.id,
                true,
              );
              if (
                locked?.status !== "active" ||
                locked.userId !== destination.userId
              )
                throw new AppError("validation", "Choose an active member");
            }
            const reassigned = await deps.reassignOpenLeads(
              tx,
              current,
              target.id,
              destination?.id ?? null,
              { at, ip: meta.ip },
            );
            await repository.deactivate(tx, target.id, at);
            await sessions.revokeAll(tx, target.userId, at);
            await invites.revokeCompanyIssuerInvites(
              tx,
              current.companyId,
              target.userId,
              at,
            );
            await audit.audit(
              tx,
              {
                user: current.user,
                role: current.role,
                agencyId: current.agencyId,
                companyId: current.companyId,
                ip: meta.ip,
              },
              "company.member_deactivated",
              { type: "company_member", id: target.id },
              { userId: target.userId },
            );
            return { reassigned };
          },
          [
            found.userId,
            ...managers,
            ...(destination ? [destination.userId] : []),
          ],
        );
      },
    };
  },

  _audit(
    tx: TenantTx,
    current: Ctx,
    meta: RequestMeta,
    action: "company.admin_invited" | "company.invite_resent",
    data: InviteResult,
  ) {
    return audit.audit(
      tx,
      {
        user: current.user,
        role: current.role,
        agencyId: current.agencyId,
        companyId: current.companyId,
        ip: meta.ip,
      },
      action,
      { type: "invite", id: data.inviteId },
      data,
    );
  },

  ownActiveCompanyIds: repository.ownActiveCompanyIds,
  readActiveForUser: repository.readActiveForUser,
  readMember: repository.read,
  hasMembership: repository.hasMembership,
  countActive: repository.countActive,
  async listSuperAdminUserIds(tx: TenantTx): Promise<string[]> {
    const { companyId } = await readCompanyScope(tx);
    return repository.activeSuperAdminUserIds(tx, companyId);
  },
  async hasActiveSuperAdmin(
    tx: TenantTx,
    companyId: string,
    userId: string,
    lock = false,
  ): Promise<boolean> {
    return (
      (await repository.readActiveForUser(tx, companyId, userId, lock))
        ?.role === "super_admin"
    );
  },
  async activateInvitedMember(
    tx: TenantTx,
    input: ActivateInvitedMemberInput,
  ): Promise<CompanyMember> {
    const { at, ...details } = input;
    const member = await repository.insert(tx, {
      ...details,
      id: v7(),
      status: "active",
      createdAt: at,
      updatedAt: at,
    });
    if (!member)
      throw new AppError(
        "conflict",
        "Invite cannot be accepted by this account",
      );
    return member;
  },
  async requireActiveMember(
    tx: TenantTx,
    companyId: string,
    memberId: string,
  ): Promise<CompanyMember> {
    const member = await repository.readActive(tx, companyId, memberId);
    if (!member) throw new AppError("not_found", "Member is unavailable");
    return member;
  },
};
export default members;
