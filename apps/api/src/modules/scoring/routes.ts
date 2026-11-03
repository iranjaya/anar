import { slugSchema } from "@anar/domain/agencies";
import { emptySchema } from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { apiSuccessSchema } from "@anar/domain/http";
import { scoringConfigSchema } from "@anar/domain/scoring";
import type { FastifyInstance } from "fastify";
import type { ScoringService } from "./config.js";

export type ScoringRouteOptions = { scoring: ScoringService };

const routes = {
  async register(
    app: FastifyInstance,
    { scoring }: ScoringRouteOptions,
  ): Promise<void> {
    const success = apiSuccessSchema(scoringConfigSchema);
    app.get<{ Params: { slug: string } }>(
      "/api/companies/:slug/scoring/getScoringDefaults",
      async (request, reply) => {
        const slug = slugSchema.safeParse(request.params.slug);
        if (!slug.success || !emptySchema.safeParse(request.query).success)
          throw new AppError("validation", "A valid company slug is required");
        const actor = await scoring.requireContext(request, slug.data);
        const data = await scoring.getScoringDefaults(actor);
        return reply.send(success.parse({ ok: true, data }));
      },
    );
  },
};
export default routes;
