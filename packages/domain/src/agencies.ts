import { z } from "zod";
import { emailSchema } from "./auth.js";
import { permissionSchema } from "./context.js";

export type { Permission } from "./context.js";

import { wireDateSchema } from "./http.js";
import type { Company } from "./tenant.js";

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

export const agencyStaffViewSchema = agencyMemberSchema.extend({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
});
export type AgencyStaffView = AgencyMember & { name: string; email: string };
export const agencyViewSchema = z.strictObject({
  agency: agencySchema,
  staff: agencyStaffViewSchema,
  capabilities: z.array(permissionSchema),
});
export type AgencyView = {
  agency: Agency;
  staff: AgencyStaffView;
  capabilities: z.infer<typeof permissionSchema>[];
};
export const agencyInviteViewSchema = z.strictObject({
  id: z.uuid(),
  email: emailSchema,
  name: agencyStaffViewSchema.shape.name,
  role: z.literal("agency_staff"),
  expiresAt: wireDateSchema,
  createdAt: wireDateSchema,
});
export type AgencyInviteView = Omit<
  z.infer<typeof agencyInviteViewSchema>,
  "expiresAt" | "createdAt"
> & { expiresAt: Date; createdAt: Date };
export const agencyStaffPageSchema = z.strictObject({
  items: z.array(agencyStaffViewSchema),
  nextCursor: z.string().nullable(),
});
export const agencyInvitePageSchema = z.strictObject({
  items: z.array(agencyInviteViewSchema),
  nextCursor: z.string().nullable(),
});
export type AgencyStaffPage = {
  items: AgencyStaffView[];
  nextCursor: string | null;
};
export type AgencyInvitePage = {
  items: AgencyInviteView[];
  nextCursor: string | null;
};
export const inviteStaffSchema = z.strictObject({
  email: emailSchema,
  name: agencyStaffViewSchema.shape.name,
});
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

export const agencyCompanySchema = z.strictObject({
  id: z.uuid(),
  agencyId: z.uuid(),
  name: agencySchema.shape.name,
  slug: slugSchema,
  status: z.enum(["active", "suspended", "closing"]),
  defaultCountry: z.literal("NP"),
  timezone: z.literal("Asia/Kathmandu"),
});
export type AgencyCompany = Company & { agencyId: string };
