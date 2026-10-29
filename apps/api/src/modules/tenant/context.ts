import {
  type PlatformDb,
  type PlatformTx,
  withPlatformAgency,
  withPlatformIdentity,
  withPlatformTenant,
} from "@anar/db/platform";
import type { TenantTx } from "@anar/db/tenant";
import type {
  Agency,
  AgencyCompany,
  AgencyMember,
} from "@anar/domain/agencies";
import { type ContextView, contextQuerySchema } from "@anar/domain/context";
import { AppError } from "@anar/domain/errors";
import type { CompanyMember } from "@anar/domain/members";
import type { FastifyRequest } from "fastify";
import type { AuthSession, SessionService } from "../auth/sessions.js";
import views from "./views.js";

export type Ctx = AuthSession & {
  agencyId: string;
  agency: Agency;
  companyId: string;
  company: AgencyCompany;
} & (
    | { role: "agency_staff"; member: null }
    | { role: "super_admin" | "admin"; member: CompanyMember }
  );
export type ContextDeps = {
  db: PlatformDb;
  sessions: Pick<SessionService, "requireSession" | "lockSessionActor">;
  readStaffMembership(
    tx: PlatformTx,
    userId: string,
  ): Promise<AgencyMember | undefined>;
  readActiveAgency(
    tx: PlatformTx,
    agencyId: string,
    lock?: boolean,
  ): Promise<Agency | undefined>;
  readAgencyCompanyBySlug(
    tx: PlatformTx,
    agencyId: string,
    slug: string,
  ): Promise<AgencyCompany | undefined>;
  discoverWorkspaces(
    tx: PlatformTx,
    userId: string,
    options: {
      slug?: string;
      cursor?: { createdAt: Date; id: string };
      limit: 1 | 2 | 51;
    },
  ): Promise<{ id: string; createdAt: Date; company: AgencyCompany }[]>;
  lockActiveCompany(
    tx: PlatformTx,
    agencyId: string,
    companyId: string,
  ): Promise<AgencyCompany | undefined>;
  readActiveMember(
    tx: PlatformTx,
    companyId: string,
    userId: string,
    lock: boolean,
  ): Promise<CompanyMember | undefined>;
};
const context = {
  create(deps: ContextDeps) {
    return {
      async requireContext(
        request: Pick<FastifyRequest, "headers">,
        slug: string,
      ): Promise<Ctx> {
        const parsed = contextQuerySchema.safeParse({ company: slug });
        if (!parsed.success)
          throw new AppError("validation", "A valid company slug is required");
        const actor = await deps.sessions.requireSession(request);
        return deps.db.transaction(async (tx) => {
          const current = await deps.sessions.lockSessionActor(tx, actor);
          context._denyOwner(current);
          const staff = await deps.readStaffMembership(tx, current.user.id);
          if (staff) {
            if (
              staff.status !== "active" ||
              !(await deps.readActiveAgency(tx, staff.agencyId))
            )
              throw new AppError(
                "forbidden",
                "Agency staff access is unavailable",
              );
            const company = await withPlatformAgency(
              tx,
              { agencyId: staff.agencyId, userId: current.user.id },
              (scoped) =>
                deps.readAgencyCompanyBySlug(scoped, staff.agencyId, slug),
            );
            if (!company)
              throw new AppError("not_found", "Company is unavailable");
            throw new AppError("forbidden", "Company entry is required");
          }
          const [found] = await withPlatformIdentity(
            tx,
            current.user.id,
            (scoped) =>
              deps.discoverWorkspaces(scoped, current.user.id, {
                slug,
                limit: 1,
              }),
          );
          if (!found) throw new AppError("not_found", "Company is unavailable");
          const resolved = await context._lockCompany(
            deps,
            tx,
            current,
            found.company,
          );
          if (resolved.company.slug !== slug)
            throw new AppError("not_found", "Company is unavailable");
          return resolved;
        });
      },
      async withContext<T>(
        actor: Ctx,
        fn: (tx: TenantTx, current: Ctx) => Promise<T>,
        affectedUserIds: string[] = [],
      ): Promise<T> {
        return deps.db.transaction(async (tx) => {
          const current = await deps.sessions.lockSessionActor(
            tx,
            actor,
            affectedUserIds,
          );
          context._denyOwner(current);
          if (await deps.readStaffMembership(tx, current.user.id))
            throw new AppError("forbidden", "Company entry is required");
          const resolved = await context._lockCompany(deps, tx, current, {
            id: actor.companyId,
            agencyId: actor.agencyId,
          });
          return fn(tx, resolved);
        });
      },
      view(actor: Ctx): ContextView {
        return views.context(actor);
      },
    };
  },
  _denyOwner(actor: AuthSession): void {
    if (actor.user.platformRole !== null)
      throw new AppError("forbidden", "Company membership is required");
  },
  async _lockCompany(
    deps: ContextDeps,
    tx: PlatformTx,
    actor: AuthSession,
    target: { agencyId: string; id: string },
  ): Promise<Ctx> {
    const agency = await deps.readActiveAgency(tx, target.agencyId, true);
    if (!agency) throw new AppError("not_found", "Company is unavailable");
    return withPlatformTenant(
      tx,
      { agencyId: agency.id, companyId: target.id, userId: actor.user.id },
      async (scoped) => {
        const company = await deps.lockActiveCompany(
          scoped,
          agency.id,
          target.id,
        );
        if (!company) throw new AppError("not_found", "Company is unavailable");
        const member = await deps.readActiveMember(
          scoped,
          company.id,
          actor.user.id,
          true,
        );
        if (!member) throw new AppError("not_found", "Company is unavailable");
        return {
          ...actor,
          agencyId: agency.id,
          agency,
          companyId: company.id,
          company,
          member,
          role: member.role,
        };
      },
    );
  },
};
export default context;
