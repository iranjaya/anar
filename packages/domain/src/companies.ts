import { z } from "zod";
import {
  type AgencyCompany,
  agencyCompanySchema,
  agencyListQuerySchema,
} from "./agencies.js";
import { emailSchema } from "./auth.js";
import { wireDateSchema } from "./http.js";

export const createCompanySchema = agencyCompanySchema.pick({
  name: true,
  slug: true,
  defaultCountry: true,
  timezone: true,
});
export const createCompanyResultSchema = z.strictObject({
  companyId: z.uuid(),
});
export const companyListQuerySchema = agencyListQuerySchema;
export const inviteSuperAdminSchema = z.strictObject({
  companyId: z.uuid(),
  email: emailSchema,
  name: z.string().trim().min(1).max(120),
});
export type InviteSuperAdminInput = z.infer<typeof inviteSuperAdminSchema>;
export const companySummarySchema = agencyCompanySchema.extend({
  memberCount: z.number().int().nonnegative(),
  leadCount: z.number().int().nonnegative(),
  lastImportAt: wireDateSchema.nullable(),
});
export const companyPageSchema = z.strictObject({
  items: z.array(companySummarySchema),
  nextCursor: z.string().nullable(),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type CreateCompanyResult = z.infer<typeof createCompanyResultSchema>;
export type CompanyListQuery = z.infer<typeof companyListQuerySchema>;
export type CompanySummary = AgencyCompany & {
  memberCount: number;
  leadCount: number;
  lastImportAt: Date | null;
};
export type CompanyPage = {
  items: CompanySummary[];
  nextCursor: string | null;
};

export const enterCompanySchema = z.strictObject({
  companyId: z.uuid(),
  reason: z.string().trim().min(5).max(500),
});
export type EnterCompanyInput = z.infer<typeof enterCompanySchema>;
