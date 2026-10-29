import {
  emptySchema,
  type SessionView,
  sessionViewSchema,
  type WorkspaceListQuery,
  type WorkspacePage,
  workspacePageSchema,
} from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { apiSuccessSchema } from "@anar/domain/http";
import type { FastifyInstance, FastifyRequest } from "fastify";

export type DiscoveryRouteOptions = {
  discovery: {
    getSession(request: Pick<FastifyRequest, "headers">): Promise<SessionView>;
    listWorkspaces(
      request: Pick<FastifyRequest, "headers">,
      query: WorkspaceListQuery,
    ): Promise<WorkspacePage>;
  };
};
const routes = {
  async register(
    app: FastifyInstance,
    options: DiscoveryRouteOptions,
  ): Promise<void> {
    const sessionOutput = apiSuccessSchema(sessionViewSchema);
    const workspaceOutput = apiSuccessSchema(workspacePageSchema);
    app.get("/api/auth/getSession", async (request, reply) => {
      if (!emptySchema.safeParse(request.query).success)
        throw new AppError("validation", "This request takes no query fields");
      const view = await options.discovery.getSession(request);
      const workspace =
        view.workspace.kind === "agency"
          ? {
              ...view.workspace,
              agency: {
                ...view.workspace.agency,
                createdAt: view.workspace.agency.createdAt.toISOString(),
              },
            }
          : view.workspace;
      return reply.send(
        sessionOutput.parse({
          ok: true,
          data: {
            ...view,
            workspace,
            session: {
              ...view.session,
              expiresAt: view.session.expiresAt.toISOString(),
              lastOtpAt: view.session.lastOtpAt.toISOString(),
              actingUntil: view.session.actingUntil?.toISOString() ?? null,
            },
          },
        }),
      );
    });
    app.get<{ Querystring: WorkspaceListQuery }>(
      "/api/auth/listWorkspaces",
      async (request, reply) => {
        const page = await options.discovery.listWorkspaces(
          request,
          request.query,
        );
        return reply.send(workspaceOutput.parse({ ok: true, data: page }));
      },
    );
  },
};
export default routes;
