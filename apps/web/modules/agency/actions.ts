"use server";

import type { InviteResult } from "@anar/domain/auth";
import { revalidatePath } from "next/cache";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";
import {
  inviteStaff,
  requestFreshCode,
  resendStaffInvite,
  verifyFreshCode,
} from "./server";

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

export async function freshCodeAction(
  _previous: ActionResult<{ verified: boolean }> | null,
  form: FormData,
): Promise<ActionResult<{ verified: boolean }>> {
  try {
    const intent = form.get("intent");
    if (intent === "request") {
      await requestFreshCode();
      return { ok: true, data: { verified: false } };
    }
    if (intent !== "verify")
      throw new AppError("validation", "Choose a code action.");
    await verifyFreshCode(String(form.get("code") ?? ""));
    return { ok: true, data: { verified: true } };
  } catch (error) {
    return actionFailure(error);
  }
}
