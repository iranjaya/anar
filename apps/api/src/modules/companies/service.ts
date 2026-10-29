import { type PlatformTx, withPlatformTenant } from "@anar/db/platform";
import type { InviteResult } from "@anar/domain/auth";
import {
  type CompanyListQuery,
  type CompanyPage,
  type CreateCompanyInput,
  type CreateCompanyResult,
  createCompanySchema,
  type InviteSuperAdminInput,
  inviteSuperAdminSchema,
} from "@anar/domain/companies";
import { AppError } from "@anar/domain/errors";
import type { FastifyRequest } from "fastify";
import { v7 } from "uuid";
import type context from "../agencies/context.js";
import pagination from "../agencies/pagination.js";
import type { AgencyCtx } from "../agencies/service.js";
import agencies from "../agencies/service.js";
import type {
  InviteService,
  ReadCompanyInviteTarget,
} from "../auth/invites.js";
import type { RequestMeta } from "../auth/sessions.js";
import members from "../members/service.js";
import audit from "../tenant/audit.js";
import stepUp from "../tenant/stepUp.js";
import repository from "./repository.js";

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
};
const companies = {
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
            stepUp.requireFreshOtp(current, deps.now());
            const result = await deps.createCompanyInvite(
              tx,
              current,
              current.agency,
              company,
              parsed.data,
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
    };
  },
  lockActiveCompany(tx: PlatformTx, agencyId: string, companyId: string) {
    return repository.readActive(tx, agencyId, companyId, true);
  },
  readCompanyInviteTarget: (async (tx, input) => {
    const agency = await agencies.readActiveStaffAgency(
      tx,
      input.agencyId,
      input.issuerId,
    );
    if (!agency) return undefined;
    const company = await withPlatformTenant(
      tx,
      {
        agencyId: input.agencyId,
        companyId: input.companyId,
        userId: input.issuerId,
      },
      (scoped) =>
        repository.readActive(scoped, input.agencyId, input.companyId, false),
    );
    return company
      ? { agencyName: agency.name, companyName: company.name }
      : undefined;
  }) satisfies ReadCompanyInviteTarget,
};
export default companies;
