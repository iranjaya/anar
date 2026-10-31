"use server";

import type { InviteResult } from "@anar/domain/auth";
import type { DeactivateMemberResult } from "@anar/domain/members";
import { revalidatePath } from "next/cache";
import { type ActionResult, actionFailure } from "@/lib/errors";
import { deactivateMember, inviteAdmin, resendInvite } from "./server";

export async function inviteAdminAction(
  slug: string,
  _previous: ActionResult<InviteResult> | null,
  form: FormData,
): Promise<ActionResult<InviteResult>> {
  try {
    const data = await inviteAdmin(slug, {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
    });
    revalidatePath(`/${slug}/settings/team`);
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function resendInviteAction(
  slug: string,
  inviteId: string,
  _previous: ActionResult<{ ok: true }> | null,
  _form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const data = await resendInvite(slug, { inviteId });
    revalidatePath(`/${slug}/settings/team`);
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deactivateMemberAction(
  slug: string,
  memberId: string,
  _previous: ActionResult<DeactivateMemberResult> | null,
  _form: FormData,
): Promise<ActionResult<DeactivateMemberResult>> {
  try {
    const data = await deactivateMember(slug, memberId);
    revalidatePath(`/${slug}/settings/team`);
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}
