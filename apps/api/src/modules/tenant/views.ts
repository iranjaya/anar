import type { Agency, AgencyCompany } from "@anar/domain/agencies";
import type { AuthUser, SessionUser, SessionView } from "@anar/domain/auth";
import type { ContextView } from "@anar/domain/context";
import type { AuthSession } from "../auth/sessions.js";
import type { Ctx } from "./context.js";
import permissions from "./permissions.js";

const views = {
  user(user: AuthUser): SessionUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      platformRole: user.platformRole,
    };
  },
  agency(agency: Agency): Agency {
    return {
      id: agency.id,
      name: agency.name,
      slug: agency.slug,
      status: agency.status,
      createdAt: agency.createdAt,
    };
  },
  company(company: AgencyCompany): AgencyCompany {
    return {
      id: company.id,
      agencyId: company.agencyId,
      name: company.name,
      slug: company.slug,
      status: company.status,
      defaultCountry: company.defaultCountry,
      timezone: company.timezone,
    };
  },
  session(
    actor: AuthSession,
    landing: Pick<SessionView, "workspace" | "redirectTo">,
  ): SessionView {
    const {
      id,
      expiresAt,
      lastOtpAt,
      actingCompanyId,
      actingReason,
      actingUntil,
    } = actor.session;
    return {
      user: views.user(actor.user),
      session: {
        id,
        expiresAt,
        lastOtpAt,
        actingCompanyId,
        actingReason,
        actingUntil,
      },
      ...landing,
    };
  },
  context(ctx: Ctx): ContextView {
    const { id, actingCompanyId, actingReason, actingUntil } = ctx.session;
    const member = ctx.member;
    return {
      agencyId: ctx.agencyId,
      agency: views.agency(ctx.agency),
      companyId: ctx.companyId,
      company: views.company(ctx.company),
      user: views.user(ctx.user),
      role: ctx.role,
      member: member
        ? {
            id: member.id,
            companyId: member.companyId,
            userId: member.userId,
            name: member.name,
            role: member.role,
            status: member.status,
          }
        : null,
      session: { id, actingCompanyId, actingReason, actingUntil },
      capabilities: permissions.capabilities(ctx),
      resourceAccess: permissions.resourceAccess(ctx),
    };
  },
};
export default views;
