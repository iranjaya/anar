import { type HealthResponse, healthResponseSchema } from "@anar/domain/health";
import type { FastifyInstance } from "fastify";
import type { HealthProbe } from "../lib/jobs/index.js";

export type HealthRouteOptions = { health?: Pick<HealthProbe, "read"> };

export default async function healthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions,
): Promise<void> {
  app.get<{ Reply: HealthResponse }>("/api/health", async (_request, reply) => {
    const state = options.health
      ? await options.health.read()
      : {
          db: "down" as const,
          lastSeenAt: null,
          workerHealthy: false,
          queue: null,
        };
    const ok = state.db === "ok" && state.workerHealthy && state.queue !== null;
    reply.code(ok ? 200 : 503);
    return healthResponseSchema.parse({
      status: ok ? "ok" : "degraded",
      service: "api",
      db: state.db,
      worker: {
        lastSeenAt: state.lastSeenAt?.toISOString() ?? null,
        healthy: state.workerHealthy,
      },
      queue: state.queue,
    });
  });
}
