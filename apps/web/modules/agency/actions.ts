"use server";

import type { InviteResult } from "@anar/domain/auth";
import { revalidatePath } from "next/cache";
import { type ActionResult, actionFailure } from "@/lib/errors";
import { deactivateStaff, inviteStaff, resendStaffInvite } from "./server";

export async function inviteStaffAction(
  _previous: ActionResult<InviteResult> | null,
  form: FormData,
): Promise<ActionResult<InviteResult>> {
  try {
    const data = await inviteStaff({
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
    });
    revalidatePath("/agency/invites");
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function resendStaffInviteAction(
  inviteId: string,
  _previous: ActionResult<{ ok: true }> | null,
  _form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const data = await resendStaffInvite({ inviteId });
    revalidatePath("/agency/invites");
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deactivateStaffAction(
  staffId: string,
  _previous: ActionResult<{ ok: true }> | null,
  _form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const data = await deactivateStaff({ staffId });
    revalidatePath("/agency/staff");
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}
