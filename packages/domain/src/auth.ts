import { z } from "zod";
import type { User } from "./tenant.js";

export type AuthUser = User & {
  deactivatedAt: Date | null;
  createdAt: Date;
};

export const bootstrapDnaSchema = z.strictObject({
  environment: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1).max(120),
});

export type BootstrapDnaInput = z.infer<typeof bootstrapDnaSchema>;
