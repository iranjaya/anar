import {
  type PlatformDb,
  type PlatformTx,
  withPlatformAgency,
  withPlatformIdentity,
} from "@anar/db/platform";
import type { Agency, AgencyMember } from "@anar/domain/agencies";
import { AppError } from "@anar/domain/errors";
import type { FastifyRequest } from "fastify";
import type { AuthSession, SessionService } from "../auth/sessions.js";
import repository from "./repository.js";
import type { AgencyCtx } from "./service.js";

export type AgencyContextDeps = {
  db: PlatformDb;
  sessions: Pick<SessionService, "requireSession" | "lockSessionActor">;
};
const context = {
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
        return deps.db.transaction(async (tx) => {
          const current = await deps.sessions.lockSessionActor(
            tx,
            actor,
            affectedUserIds,
          );
          const agency = await repository.lockAgency(tx, actor.agencyId);
          return withPlatformAgency(
            tx,
            { agencyId: actor.agencyId, userId: current.user.id },
            async (scoped) => {
              const staff = await repository.lockStaff(
                scoped,
                actor.agencyId,
                current.user.id,
              );
              return fn(scoped, context._current(current, agency, staff));
            },
          );
        });
      },
    };
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
