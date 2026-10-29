import { z } from "zod";
import { wireDateSchema } from "./http.js";
import type { JobPayload } from "./jobs.js";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  platformRole: "owner" | null;
  deactivatedAt: Date | null;
  createdAt: Date;
};

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
export const emptySchema = z.strictObject({});
export const requestOtpSchema = z.strictObject({ email: emailSchema });
export const verifyOtpSchema = z.strictObject({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/),
});
export const stepUpSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/),
});
export type StepUpInput = z.infer<typeof stepUpSchema>;
export const verifyOtpResultSchema = z.strictObject({
  redirectTo: z.literal("/workspaces"),
});
export const okSchema = z.strictObject({ ok: z.literal(true) });
export const sessionListSchema = z.array(
  z.strictObject({
    id: z.uuid(),
    deviceLabel: z.string(),
    lastSeenAt: wireDateSchema,
    current: z.boolean(),
  }),
);
export const revokeSessionSchema = z.strictObject({ sessionId: z.uuid() });
export type SessionList = z.infer<typeof sessionListSchema>;
export type RevokeSessionInput = z.infer<typeof revokeSessionSchema>;
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const otpEmailJobSchema = z.strictObject({
  kind: z.literal("otp"),
  referenceId: z.uuid(),
  expiresAt: wireDateSchema,
  encryptedMessage: z.string().min(1),
}) satisfies z.ZodType<JobPayload>;

export const bootstrapOwnerSchema = z.strictObject({
  environment: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/),
  email: emailSchema,
  name: z.string().trim().min(1).max(120),
});

export type BootstrapOwnerInput = z.infer<typeof bootstrapOwnerSchema>;
