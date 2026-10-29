import "server-only";
import {
  agencyInvitePageSchema,
  agencyInviteViewSchema,
  agencyListQuerySchema,
  agencySchema,
  agencyStaffPageSchema,
  agencyStaffViewSchema,
  agencyViewSchema,
  type InviteStaffInput,
  inviteStaffSchema,
} from "@anar/domain/agencies";
import {
  inviteResultSchema,
  okSchema,
  type ResendInviteInput,
  resendInviteSchema,
} from "@anar/domain/auth";
import type { z } from "zod";
import { apiDateSchema, apiRequest } from "@/lib/api/client";
import { authEnabled } from "@/lib/api/mode";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";
import {
  requestFreshCode as requestCode,
  verifyFreshCode as verifyCode,
} from "@/modules/auth/server";

const readiness = {
  enabled: false,
  message:
    "Agency access is not available yet. No staff or invitations have been loaded.",
};
const staffSchema = agencyStaffViewSchema.extend({
  createdAt: apiDateSchema,
  updatedAt: apiDateSchema,
  deactivatedAt: apiDateSchema.nullable(),
});
const viewSchema = agencyViewSchema.extend({
  agency: agencySchema.extend({ createdAt: apiDateSchema }),
  staff: staffSchema,
});
const staffPageSchema = agencyStaffPageSchema.extend({
  items: staffSchema.array(),
});
const invitePageSchema = agencyInvitePageSchema.extend({
  items: agencyInviteViewSchema
    .extend({ createdAt: apiDateSchema, expiresAt: apiDateSchema })
    .array(),
});

export function getAgencyReadiness() {
  return { ...readiness, enabled: authEnabled() };
}

function requireReady() {
  if (!authEnabled()) throw new AppError("unavailable", readiness.message);
}

async function read<T>(
  path: string,
  schema: z.ZodType<T>,
  query?: unknown,
): Promise<ActionResult<T> | null> {
  if (!authEnabled()) return null;
  try {
    const parsed = agencyListQuerySchema.safeParse(query ?? {});
    if (!parsed.success)
      throw new AppError("validation", "Invalid page cursor.");
    const data = await apiRequest({ path, query: parsed.data }, schema);
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export function getAgency() {
  return read("/api/agencies/getAgency", viewSchema);
}
export function listStaff(query: unknown) {
  return read("/api/agencies/listStaff", staffPageSchema, query);
}
export function listInvites(query: unknown) {
  return read("/api/agencies/listInvites", invitePageSchema, query);
}

export async function inviteStaff(input: InviteStaffInput) {
  requireReady();
  const parsed = inviteStaffSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Enter your colleague’s name and email.");
  return apiRequest(
    { path: "/api/agencies/inviteStaff", method: "POST", body: parsed.data },
    inviteResultSchema,
  );
}

export async function resendStaffInvite(input: ResendInviteInput) {
  requireReady();
  const parsed = resendInviteSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Choose an invitation to resend.");
  return apiRequest(
    {
      path: "/api/agencies/resendStaffInvite",
      method: "POST",
      body: parsed.data,
    },
    okSchema,
  );
}

export async function requestFreshCode() {
  requireReady();
  return requestCode();
}

export async function verifyFreshCode(code: string) {
  requireReady();
  return verifyCode(code);
}
