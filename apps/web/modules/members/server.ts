import "server-only";
import { slugSchema } from "@anar/domain/agencies";
import {
  inviteResultSchema,
  okSchema,
  type ResendInviteInput,
  resendInviteSchema,
} from "@anar/domain/auth";
import {
  type AgencyEntry,
  agencyEntrySchema,
  deactivateMemberResultSchema,
  deactivateMemberSchema,
  type InviteAdminInput,
  inviteAdminSchema,
  type MemberView,
  memberListSchema,
  type PendingInvite,
  pendingInviteSchema,
} from "@anar/domain/members";
import type { z } from "zod";
import { apiDateSchema, apiRequest } from "@/lib/api/client";
import { authEnabled } from "@/lib/api/mode";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";

export { listMembers } from "./data/members";

const inviteListSchema = pendingInviteSchema
  .extend({ expiresAt: apiDateSchema })
  .array();
const entryListSchema = agencyEntrySchema
  .extend({ enteredAt: apiDateSchema })
  .array();

async function read<T>(
  slug: string,
  path: "listMembers" | "listInvites" | "listAgencyEntries",
  schema: z.ZodType<T>,
): Promise<ActionResult<T> | null> {
  if (!authEnabled()) return null;
  try {
    const parsed = slugSchema.safeParse(slug);
    if (!parsed.success) throw new AppError("not_found", "Company not found.");
    const data = await apiRequest(
      { path: `/api/companies/${parsed.data}/members/${path}` },
      schema,
    );
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export function listTeam(slug: string) {
  return read<MemberView[]>(slug, "listMembers", memberListSchema);
}

export function listPendingInvites(slug: string) {
  return read<PendingInvite[]>(slug, "listInvites", inviteListSchema);
}

export function listAgencyEntries(slug: string) {
  return read<AgencyEntry[]>(slug, "listAgencyEntries", entryListSchema);
}

export async function inviteAdmin(slug: string, input: InviteAdminInput) {
  const company = requireSlug(slug);
  const parsed = inviteAdminSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Enter the Admin’s name and email.");
  return apiRequest(
    {
      path: `/api/companies/${company}/members/inviteAdmin`,
      method: "POST",
      body: parsed.data,
    },
    inviteResultSchema,
  );
}

export async function resendInvite(slug: string, input: ResendInviteInput) {
  const company = requireSlug(slug);
  const parsed = resendInviteSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Choose an invitation to resend.");
  return apiRequest(
    {
      path: `/api/companies/${company}/members/resendInvite`,
      method: "POST",
      body: parsed.data,
    },
    okSchema,
  );
}

function requireReady() {
  if (!authEnabled())
    throw new AppError("unavailable", "Team management is not available yet.");
}

function requireSlug(slug: string) {
  requireReady();
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) throw new AppError("not_found", "Company not found.");
  return parsed.data;
}

export async function deactivateMember(slug: string, memberId: string) {
  const company = requireSlug(slug);
  const parsed = deactivateMemberSchema.safeParse({ memberId });
  if (!parsed.success)
    throw new AppError("validation", "Choose a member to remove.");
  return apiRequest(
    {
      path: `/api/companies/${company}/members/deactivateMember`,
      method: "POST",
      body: parsed.data,
    },
    deactivateMemberResultSchema,
  );
}
