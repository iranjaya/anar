import { z } from "zod";
import {
  type Agency,
  type AgencyCompany,
  agencyCompanySchema,
  agencyListQuerySchema,
  agencySchema,
} from "./agencies.js";
import { emailSchema } from "./identity.js";

export { emailSchema } from "./identity.js";

export const inviteResultSchema = z.strictObject({ inviteId: z.uuid() });
export const resendInviteSchema = z.strictObject({ inviteId: z.uuid() });
export type InviteResult = z.infer<typeof inviteResultSchema>;
export type ResendInviteInput = z.infer<typeof resendInviteSchema>;

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

export const inviteEmailJobSchema = otpEmailJobSchema.extend({
  kind: z.literal("invite"),
});
export const authEmailJobSchema = z.discriminatedUnion("kind", [
  otpEmailJobSchema,
  inviteEmailJobSchema,
]);
export const inviteTokenSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const acceptInviteSchema = inviteTokenSchema.extend({
  name: z.string().trim().min(1).max(120),
});
export const acceptInviteResultSchema = z.strictObject({ userId: z.uuid() });
const inviteViewFields = {
  email: emailSchema,
  name: z.string().trim().min(1).max(120),
  agencyName: z.string().trim().min(1).max(160),
  expiresAt: wireDateSchema,
};
export const inviteViewSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...inviteViewFields,
    kind: z.literal("agency_staff"),
    companyName: z.null(),
  }),
  z.strictObject({
    ...inviteViewFields,
    kind: z.literal("company_member"),
    companyName: z.string().trim().min(1).max(160),
  }),
]);
export type InviteTokenInput = z.infer<typeof inviteTokenSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type AcceptInviteResult = z.infer<typeof acceptInviteResultSchema>;
export type InviteView = Omit<z.infer<typeof inviteViewSchema>, "expiresAt"> & {
  expiresAt: Date;
};

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

export const sessionUserSchema = z.strictObject({
  id: z.uuid(),
  email: emailSchema,
  name: z.string().trim().min(1).max(120),
  platformRole: z.literal("owner").nullable(),
});
export const sessionStateViewSchema = z.strictObject({
  id: z.uuid(),
  expiresAt: wireDateSchema,
  lastOtpAt: wireDateSchema,
  actingCompanyId: z.uuid().nullable(),
  actingReason: z.string().nullable(),
  actingUntil: wireDateSchema.nullable(),
});
export const workspaceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("owner") }),
  z.strictObject({ kind: z.literal("agency"), agency: agencySchema }),
  z.strictObject({ kind: z.literal("company") }),
  z.strictObject({ kind: z.literal("none") }),
]);
export const sessionViewSchema = z.strictObject({
  user: sessionUserSchema,
  session: sessionStateViewSchema,
  workspace: workspaceSchema,
  redirectTo: z.string().regex(/^\/(?:[a-z0-9-]+\/?)*$/),
});
export const workspaceListQuerySchema = agencyListQuerySchema;
export const workspacePageSchema = z.strictObject({
  items: z.array(agencyCompanySchema),
  nextCursor: z.string().nullable(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type SessionView = Omit<
  z.infer<typeof sessionViewSchema>,
  "session" | "workspace"
> & {
  session: Omit<
    z.infer<typeof sessionStateViewSchema>,
    "expiresAt" | "lastOtpAt" | "actingUntil"
  > & { expiresAt: Date; lastOtpAt: Date; actingUntil: Date | null };
  workspace:
    | { kind: "owner" }
    | { kind: "agency"; agency: Agency }
    | { kind: "company" }
    | { kind: "none" };
};
export type WorkspaceListQuery = z.infer<typeof workspaceListQuerySchema>;
export type WorkspacePage = {
  items: AgencyCompany[];
  nextCursor: string | null;
};
