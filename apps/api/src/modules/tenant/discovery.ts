import { type PlatformTx, withPlatformIdentity } from "@anar/db/platform";
import type {
  SessionView,
  WorkspaceListQuery,
  WorkspacePage,
} from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import type { FastifyRequest } from "fastify";
import pagination from "../agencies/pagination.js";
import type { AuthSession, SessionService } from "../auth/sessions.js";
import type { ContextDeps } from "./context.js";
import views from "./views.js";

export type DiscoveryDeps = Pick<
  ContextDeps,
  "readStaffMembership" | "readActiveAgency" | "discoverWorkspaces"
> & {
  sessions: Pick<SessionService, "requireSession" | "withPlatformSession">;
};

const discovery = {
  create(deps: DiscoveryDeps) {
    return {
      async getSession(
        request: Pick<FastifyRequest, "headers">,
      ): Promise<SessionView> {
        const actor = await deps.sessions.requireSession(request);
        return deps.sessions.withPlatformSession(actor, async (tx, current) =>
          views.session(current, await discovery._landing(deps, tx, current)),
        );
      },
      async listWorkspaces(
        request: Pick<FastifyRequest, "headers">,
        query: WorkspaceListQuery,
      ): Promise<WorkspacePage> {
        const actor = await deps.sessions.requireSession(request);
        const cursor = pagination.cursor(query);
        return deps.sessions.withPlatformSession(actor, async (tx, current) => {
          if (
            current.user.platformRole !== null ||
            (await deps.readStaffMembership(tx, current.user.id))
          )
            throw new AppError("forbidden", "Company membership is required");
          const rows = await withPlatformIdentity(
            tx,
            current.user.id,
            (scoped) =>
              deps.discoverWorkspaces(scoped, current.user.id, {
                cursor,
                limit: 51,
              }),
          );
          const page = pagination.page(rows);
          return {
            items: page.items.map((row) => row.company),
            nextCursor: page.nextCursor,
          };
        });
      },
    };
  },
  async _landing(
    deps: DiscoveryDeps,
    tx: PlatformTx,
    actor: AuthSession,
  ): Promise<Pick<SessionView, "workspace" | "redirectTo">> {
    if (actor.user.platformRole === "owner")
      return { workspace: { kind: "owner" }, redirectTo: "/owner/agencies" };
    const staff = await deps.readStaffMembership(tx, actor.user.id);
    if (staff) {
      const agency =
        staff.status === "active"
          ? await deps.readActiveAgency(tx, staff.agencyId)
          : undefined;
      return agency
        ? {
            workspace: { kind: "agency", agency: views.agency(agency) },
            redirectTo: "/agency/companies",
          }
        : { workspace: { kind: "none" }, redirectTo: "/account" };
    }
    const rows = await withPlatformIdentity(tx, actor.user.id, (scoped) =>
      deps.discoverWorkspaces(scoped, actor.user.id, { limit: 2 }),
    );
    if (!rows.length)
      return { workspace: { kind: "none" }, redirectTo: "/account" };
    return {
      workspace: { kind: "company" },
      redirectTo:
        rows.length === 1 ? `/${rows[0].company.slug}` : "/workspaces",
    };
  },
};
export default discovery;
