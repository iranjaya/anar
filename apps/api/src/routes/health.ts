import { type HealthResponse, healthResponseSchema } from "@anar/domain/health";
import type { FastifyInstance } from "fastify";

export default async function healthRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Reply: HealthResponse }>("/api/health", async () =>
    healthResponseSchema.parse({ status: "ok", service: "api" }),
  );
}
