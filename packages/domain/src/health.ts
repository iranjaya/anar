import { z } from "zod";
import { wireDateSchema } from "./http.js";

const countSchema = z.number().int().nonnegative();

export const healthResponseSchema = z.strictObject({
  status: z.enum(["ok", "degraded"]),
  service: z.literal("api"),
  db: z.enum(["ok", "down"]),
  worker: z.strictObject({
    lastSeenAt: wireDateSchema.nullable(),
    healthy: z.boolean(),
  }),
  queue: z
    .strictObject({
      waiting: countSchema,
      active: countSchema,
      failed: countSchema,
    })
    .nullable(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
