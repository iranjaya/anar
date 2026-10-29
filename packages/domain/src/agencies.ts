import { z } from "zod";
import { emailSchema } from "./auth.js";
import { wireDateSchema } from "./http.js";

const reservedSlugs = new Set([
  "owner",
  "agency",
  "login",
  "invite",
  "account",
  "workspaces",
  "companies",
  "api",
  "dashboard",
  "leads",
  "imports",
  "today",
  "settings",
  "reports",
]);
export const slugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
  .refine((slug) => !reservedSlugs.has(slug), "Choose another slug");
export const agencySchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(160),
  slug: slugSchema,
  status: z.enum(["pending", "active", "suspended", "closing"]),
  createdAt: wireDateSchema,
});
export type Agency = Omit<z.infer<typeof agencySchema>, "createdAt"> & {
  createdAt: Date;
};
export const agencyMemberSchema = z.strictObject({
  id: z.uuid(),
  agencyId: z.uuid(),
  userId: z.uuid(),
  status: z.enum(["active", "deactivated"]),
  invitedBy: z.uuid(),
  deactivatedAt: wireDateSchema.nullable(),
  createdAt: wireDateSchema,
  updatedAt: wireDateSchema,
});
export type AgencyMember = Omit<
  z.infer<typeof agencyMemberSchema>,
  "deactivatedAt" | "createdAt" | "updatedAt"
> & {
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
export const createAgencySchema = z.strictObject({
  name: agencySchema.shape.name,
  slug: slugSchema,
  email: emailSchema,
  staffName: z.string().trim().min(1).max(120),
});
export const createAgencyResultSchema = z.strictObject({
  agencyId: z.uuid(),
  inviteId: z.uuid(),
});
export const agencyListQuerySchema = z.strictObject({
  cursor: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
export const agencyCursorSchema = z.strictObject({
  createdAt: wireDateSchema,
  id: z.uuid(),
});
export const agencyPageSchema = z.strictObject({
  items: z.array(agencySchema),
  nextCursor: z.string().nullable(),
});
export const resendFirstInviteSchema = z.strictObject({ agencyId: z.uuid() });
export type CreateAgencyInput = z.infer<typeof createAgencySchema>;
export type CreateAgencyResult = z.infer<typeof createAgencyResultSchema>;
export type AgencyListQuery = z.infer<typeof agencyListQuerySchema>;
export type AgencyPage = { items: Agency[]; nextCursor: string | null };
export type ResendFirstInviteInput = z.infer<typeof resendFirstInviteSchema>;
