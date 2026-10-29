import "server-only";
import {
  type AgencyPage,
  agencyListQuerySchema,
  agencyPageSchema,
  agencySchema,
  type CreateAgencyInput,
  createAgencyResultSchema,
  createAgencySchema,
  type ResendFirstInviteInput,
  resendFirstInviteSchema,
} from "@anar/domain/agencies";
import { okSchema } from "@anar/domain/auth";
import { apiDateSchema, apiRequest } from "@/lib/api/client";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";

const readiness = {
  enabled: false,
  message:
    "Agency management is not available yet. No agencies have been loaded.",
};
const pageSchema = agencyPageSchema.extend({
  items: agencySchema.extend({ createdAt: apiDateSchema }).array(),
});

export function getOwnerReadiness() {
  return readiness;
}

function requireReady() {
  if (!readiness.enabled) throw new AppError("unavailable", readiness.message);
}

export async function listAgencies(
  query: unknown,
): Promise<ActionResult<AgencyPage> | null> {
  if (!readiness.enabled) return null;
  try {
    const parsed = agencyListQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new AppError("validation", "Invalid agency cursor.");
    const data = await apiRequest(
      { path: "/api/agencies/listAgencies", query: parsed.data },
      pageSchema,
    );
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function createAgency(input: CreateAgencyInput) {
  requireReady();
  const parsed = createAgencySchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      "validation",
      "Check the agency name, slug and first staff details.",
    );
  return apiRequest(
    { path: "/api/agencies/createAgency", method: "POST", body: parsed.data },
    createAgencyResultSchema,
  );
}

export async function resendFirstInvite(input: ResendFirstInviteInput) {
  requireReady();
  const parsed = resendFirstInviteSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Choose a pending agency.");
  return apiRequest(
    {
      path: "/api/agencies/resendFirstInvite",
      method: "POST",
      body: parsed.data,
    },
    okSchema,
  );
}
