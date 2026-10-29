import { contextQuerySchema, contextViewSchema } from "@anar/domain/context";
import { AppError } from "@anar/domain/errors";
import { apiSuccessSchema } from "@anar/domain/http";
import type { FastifyInstance } from "fastify";
import type context from "./context.js";

export type ContextRouteOptions = {
  context: Pick<ReturnType<typeof context.create>, "requireContext" | "view">;
};
const routes = {
  async register(
    app: FastifyInstance,
    options: ContextRouteOptions,
  ): Promise<void> {
    const output = apiSuccessSchema(contextViewSchema);
    app.get("/api/context", async (request, reply) => {
      const parsed = contextQuerySchema.safeParse(request.query);
      if (!parsed.success)
        throw new AppError("validation", "A valid company slug is required");
      const ctx = await options.context.requireContext(
        request,
        parsed.data.company,
      );
      const view = options.context.view(ctx);
      return reply.send(
        output.parse({
          ok: true,
          data: {
            ...view,
            agency: {
              ...view.agency,
              createdAt: view.agency.createdAt.toISOString(),
            },
            session: {
              ...view.session,
              actingUntil: view.session.actingUntil?.toISOString() ?? null,
            },
          },
        }),
      );
    });
  },
};
export default routes;
