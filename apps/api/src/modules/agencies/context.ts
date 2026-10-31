import {
  createPlatformDb,
  type PlatformDb,
  type PlatformTx,
  withPlatformAgency,
  withPlatformIdentity,
} from "@anar/db/platform";
import type {
  Agency,
  AgencyCompany,
  AgencyMember,
} from "@anar/domain/agencies";
import { AppError } from "@anar/domain/errors";
import type { FastifyRequest } from "fastify";
import type { AuthSession, SessionService } from "../auth/sessions.js";
import repository from "./repository.js";
import type { AgencyCtx } from "./service.js";

export type AgencyContextDeps = {
  db: PlatformDb;
  sessions: Pick<SessionService, "requireSession" | "lockSessionActor">;
};
type AgencyOperation<T> =
  | { run(tx: PlatformTx, actor: AgencyCtx): Promise<T> }
  | {
      companyId: string;
      lockCompany(
        tx: PlatformTx,
        agencyId: string,
        companyId: string,
      ): Promise<AgencyCompany | undefined>;
      run(tx: PlatformTx, actor: AgencyCtx, company: AgencyCompany): Promise<T>;
    };
const context = {
  async start(
    options: Omit<AgencyContextDeps, "db"> & { connectionString: string },
  ) {
    const db = await createPlatformDb(options.connectionString);
    return {
      service: context.create({ db, sessions: options.sessions }),
      close: db.close,
    };
  },
  create(deps: AgencyContextDeps) {
    return {
      async requireAgencyContext(
        request: Pick<FastifyRequest, "headers">,
      ): Promise<AgencyCtx> {
        const actor = await deps.sessions.requireSession(request);
        return deps.db.transaction(async (tx) => {
          const current = await deps.sessions.lockSessionActor(tx, actor);
          if (current.user.platformRole !== null)
            throw new AppError("forbidden", "Agency staff access is required");
          const staff = await withPlatformIdentity(
            tx,
            current.user.id,
            (scoped) => repository.readOwnStaff(scoped, current.user.id),
          );
          const agency = staff
            ? await repository.readAgency(tx, staff.agencyId)
            : undefined;
          return context._current(current, agency, staff);
        });
      },

      async withAgencyContext<T>(
        actor: AgencyCtx,
        fn: (tx: PlatformTx, current: AgencyCtx) => Promise<T>,
        affectedUserIds: string[] = [],
      ): Promise<T> {
        return context._withContext(deps, actor, affectedUserIds, { run: fn });
      },
      async withSession<T>(
        request: Pick<FastifyRequest, "headers">,
        fn: (tx: PlatformTx, current: AuthSession) => Promise<T>,
      ): Promise<T> {
        const actor = await deps.sessions.requireSession(request);
        return deps.db.transaction(async (tx) =>
          fn(tx, await deps.sessions.lockSessionActor(tx, actor)),
        );
      },
      withAgencyCompany<T>(
        actor: AgencyCtx,
        companyId: string,
        lockCompany: (
          tx: PlatformTx,
          agencyId: string,
          companyId: string,
        ) => Promise<AgencyCompany | undefined>,
        fn: (
          tx: PlatformTx,
          current: AgencyCtx,
          company: AgencyCompany,
        ) => Promise<T>,
      ): Promise<T> {
        return context._withContext(deps, actor, [], {
          companyId,
          lockCompany,
          run: fn,
        });
      },
    };
  },

  async _withContext<T>(
    deps: AgencyContextDeps,
    actor: AgencyCtx,
    affectedUserIds: string[],
    operation: AgencyOperation<T>,
  ): Promise<T> {
    return deps.db.transaction(async (tx) => {
      const current = await deps.sessions.lockSessionActor(
        tx,
        actor,
        affectedUserIds,
      );
      const agency = await repository.lockAgency(tx, actor.agencyId);
      if (current.user.platformRole !== null || agency?.status !== "active")
        throw new AppError("forbidden", "Agency staff access is required");
      return withPlatformAgency(
        tx,
        { agencyId: agency.id, userId: current.user.id },
        async (scoped) => {
          const company =
            "companyId" in operation
              ? await operation.lockCompany(
                  scoped,
                  agency.id,
                  operation.companyId,
                )
              : undefined;
          const staff = await repository.lockStaff(
            scoped,
            agency.id,
            current.user.id,
          );
          const authorized = context._current(current, agency, staff);
          if ("companyId" in operation) {
            if (!company)
              throw new AppError("not_found", "Company is unavailable");
            return operation.run(scoped, authorized, company);
          }
          return operation.run(scoped, authorized);
        },
      );
    });
  },

  _current(
    actor: AuthSession,
    agency: Agency | undefined,
    staff: AgencyMember | undefined,
  ): AgencyCtx {
    if (
      actor.user.platformRole !== null ||
      agency?.status !== "active" ||
      staff?.status !== "active" ||
      staff.agencyId !== agency.id
    ) {
      throw new AppError("forbidden", "Agency staff access is required");
    }
    return {
      ...actor,
      role: "agency_staff",
      agency,
      agencyId: agency.id,
      staff,
    };
  },
};

export default context;
