import "server-only";
import { inviteResultSchema, okSchema } from "@anar/domain/auth";
import {
  companyListQuerySchema,
  companyPageSchema,
  companySummarySchema,
  type CreateCompanyInput,
  createCompanyResultSchema,
  createCompanySchema,
  type EnterCompanyInput,
  enterCompanySchema,
  type InviteSuperAdminInput,
  inviteSuperAdminSchema,
} from "@anar/domain/companies";
import { apiDateSchema, apiRequest } from "@/lib/api/client";
import { authEnabled } from "@/lib/api/mode";
import { AppError, actionFailure } from "@/lib/errors";

export { listCompanies } from "./data/companies";
export { enterCompany } from "./data/companies";
export { leaveCompany } from "./data/companies";

const readiness = {
  enabled: false,
  message:
    "Company access is not available yet. No companies have been loaded.",
};
const pageSchema = companyPageSchema.extend({
  items: companySummarySchema
    .extend({ lastImportAt: apiDateSchema.nullable() })
    .array(),
});

export function getCompanyReadiness() {
  return { ...readiness, enabled: authEnabled() };
}

function requireReady() {
  if (!authEnabled()) throw new AppError("unavailable", readiness.message);
}

export async function listAgencyCompanies(query: unknown) {
  if (!authEnabled()) return null;
  try {
    const parsed = companyListQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new AppError("validation", "Invalid page cursor.");
    const data = await apiRequest(
      { path: "/api/companies/listCompanies", query: parsed.data },
      pageSchema,
    );
    return { ok: true as const, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function createCompany(input: CreateCompanyInput) {
  requireReady();
  const parsed = createCompanySchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      "validation",
      "Enter a company name and an available slug (3–63 lowercase letters, numbers or hyphens).",
    );
  return apiRequest(
    { path: "/api/companies/createCompany", method: "POST", body: parsed.data },
    createCompanyResultSchema,
  );
}

export async function inviteSuperAdmin(input: InviteSuperAdminInput) {
  requireReady();
  const parsed = inviteSuperAdminSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      "validation",
      "Choose a company and enter the Super Admin’s name and email.",
    );
  return apiRequest(
    {
      path: "/api/companies/inviteSuperAdmin",
      method: "POST",
      body: parsed.data,
    },
    inviteResultSchema,
  );
}

export async function enterAgencyCompany(input: EnterCompanyInput) {
  requireReady();
  const parsed = enterCompanySchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Give a reason of at least 5 characters.");
  return apiRequest(
    { path: "/api/companies/enterCompany", method: "POST", body: parsed.data },
    okSchema,
  );
}

export async function leaveAgencyCompany() {
  requireReady();
  return apiRequest(
    { path: "/api/companies/leaveCompany", method: "POST", body: {} },
    okSchema,
  );
}
