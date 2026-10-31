import { type PlatformTx, withPlatformTenant } from "@anar/db/platform";
import type { InviteResult } from "@anar/domain/auth";
import {
  type CompanyListQuery,
  type CompanyPage,
  type CreateCompanyInput,
  type CreateCompanyResult,
  createCompanySchema,
  type EnterCompanyInput,
  enterCompanySchema,
  type InviteSuperAdminInput,
  inviteSuperAdminSchema,
} from "@anar/domain/companies";
import { AppError } from "@anar/domain/errors";
import type { FastifyRequest } from "fastify";
import { v7 } from "uuid";
import type context from "../agencies/context.js";
import pagination from "../agencies/pagination.js";
import agencies, { type AgencyCtx } from "../agencies/service.js";
import type { InviteService } from "../auth/invites.js";
import sessions, { type RequestMeta } from "../auth/sessions.js";
import members from "../members/service.js";
import audit from "../tenant/audit.js";
import permissions from "../tenant/permissions.js";
import stepUp from "../tenant/stepUp.js";
import inviteTargets from "./inviteTargets.js";
import repository, { type WorkspaceSelection } from "./repository.js";

export type CompanyDeps = {
  context: ReturnType<typeof context.create>;
  now(): Date;
  createCompanyInvite: InviteService["createCompanyInvite"];
};
export type CompanyService = {
  inviteSuperAdmin(
    actor: AgencyCtx,
    input: InviteSuperAdminInput,
    meta: RequestMeta,
  ): Promise<InviteResult>;
  requireAgencyContext(
    request: Pick<FastifyRequest, "headers">,
  ): Promise<AgencyCtx>;
  createCompany(
    actor: AgencyCtx,
    input: CreateCompanyInput,
    meta: RequestMeta,
  ): Promise<CreateCompanyResult>;
  listCompanies(
    actor: AgencyCtx,
    query: CompanyListQuery,
  ): Promise<CompanyPage>;
  enterCompany(
    actor: AgencyCtx,
    input: EnterCompanyInput,
    meta: RequestMeta,
  ): Promise<void>;
  leaveCompany(
    request: Pick<FastifyRequest, "headers">,
    meta: RequestMeta,
  ): Promise<void>;
};
const actingHours = 8;
const companies = {
  discoverWorkspaces(
    tx: PlatformTx,
    userId: string,
    options: WorkspaceSelection,
  ) {
    return repository.discoverWorkspaces(
      tx,
      members.ownActiveCompanyIds(tx, userId),
      options,
    );
  },
  readAgencyCompanyBySlug: repository.readAgencyCompanyBySlug,
  create(deps: CompanyDeps): CompanyService {
    return {
      requireAgencyContext: deps.context.requireAgencyContext,
      async inviteSuperAdmin(actor, input, meta) {
        const parsed = inviteSuperAdminSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError("validation", "Check the invitation details");
        return deps.context.withAgencyCompany(
          actor,
          parsed.data.companyId,
          companies.lockActiveCompany,
          async (tx, current, company) => {
            permissions.require(current, "members.invite_super_admin", {
              agencyId: company.agencyId,
              companyId: company.id,
            });
            stepUp.requireFreshOtp(current, deps.now());
            const result = await deps.createCompanyInvite(
              tx,
              current,
              current.agency,
              company,
              {
                email: parsed.data.email,
                name: parsed.data.name,
                role: "super_admin",
              },
            );
            await audit.audit(
              tx,
              {
                user: current.user,
                role: current.role,
                agencyId: current.agencyId,
                companyId: company.id,
                ip: meta.ip,
              },
              "company.super_admin_invited",
              { type: "invite", id: result.inviteId },
              result,
            );
            return result;
          },
        );
      },
      async createCompany(actor, input, meta) {
        const parsed = createCompanySchema.safeParse(input);
        if (!parsed.success) {
          if (
            parsed.error.issues.some(
              (issue) =>
                issue.code === "custom" &&
                issue.path.length === 1 &&
                issue.path[0] === "slug",
            )
          ) {
            throw new AppError("conflict", "Company slug is unavailable");
          }
          throw new AppError("validation", "Check the company details");
        }
        return deps.context.withAgencyContext(actor, async (tx, current) => {
          permissions.require(current, "company.create");
          const at = deps.now();
          stepUp.requireFreshOtp(current, at);
          const company = await repository.create(tx, {
            ...parsed.data,
            id: v7(),
            agencyId: current.agencyId,
            status: "active",
            settings: { super_admin_can_import: false },
            createdAt: at,
            updatedAt: at,
          });
          if (!company)
            throw new AppError("conflict", "Company slug is unavailable");
          await audit.audit(
            tx,
            {
              user: current.user,
              role: current.role,
              agencyId: current.agencyId,
              companyId: company.companyId,
              ip: meta.ip,
            },
            "company.created",
            { type: "company", id: company.companyId },
            { companyId: company.companyId },
          );
          return company;
        });
      },
      listCompanies(actor, query) {
        const cursor = pagination.cursor(query);
        return deps.context.withAgencyContext(actor, async (tx, current) => {
          permissions.require(current, "company.list");
          const page = pagination.page(
            await repository.listSummaries(tx, current.agencyId, cursor),
          );
          const items = [];
          for (const row of page.items) {
            const memberCount = await withPlatformTenant(
              tx,
              {
                agencyId: current.agencyId,
                companyId: row.id,
                userId: current.user.id,
              },
              (scoped) => members.countActive(scoped, row.id),
            );
            items.push({ ...row.summary, memberCount });
          }
          return {
            items,
            nextCursor: page.nextCursor,
          };
        });
      },
      async enterCompany(actor, input, meta) {
        const parsed = enterCompanySchema.safeParse(input);
        if (!parsed.success)
          throw new AppError(
            "validation",
            "Give a reason of at least 5 characters",
          );
        const { companyId, reason } = parsed.data;
        return deps.context.withAgencyCompany(
          actor,
          companyId,
          companies.lockActiveCompany,
          async (tx, current, company) => {
            permissions.require(current, "company.enter", {
              agencyId: company.agencyId,
              companyId: company.id,
            });
            const until = new Date(
              deps.now().getTime() + actingHours * 3600000,
            );
            await sessions.setActing(tx, current.session, {
              companyId: company.id,
              reason,
              until,
            });
            await audit.audit(
              tx,
              {
                user: current.user,
                role: current.role,
                agencyId: current.agencyId,
                companyId: company.id,
                ip: meta.ip,
              },
              "agency.enter_company",
              { type: "company", id: company.id },
              { companyId: company.id, reason },
            );
          },
        );
      },
      async leaveCompany(request, meta) {
        await deps.context.withSession(request, async (tx, current) => {
          if (current.user.platformRole !== null)
            throw new AppError("forbidden", "Agency staff access is required");
          const companyId = current.session.actingCompanyId;
          if (companyId === null) return;
          await sessions.setActing(tx, current.session, null);
          const staff = await agencies.readStaffMembership(tx, current.user.id);
          await audit.audit(
            tx,
            {
              user: current.user,
              role: "agency_staff",
              agencyId: staff?.agencyId ?? null,
              companyId: staff ? companyId : null,
              ip: meta.ip,
            },
            "agency.leave_company",
            { type: "company", id: companyId },
            { companyId },
          );
        });
      },
    };
  },
  lockActiveCompany(tx: PlatformTx, agencyId: string, companyId: string) {
    return repository.readActive(tx, agencyId, companyId, true);
  },
  readCompanyInviteTarget: inviteTargets.read,
  lockCompanyInviteTarget: inviteTargets.lock,
};
export default companies;
