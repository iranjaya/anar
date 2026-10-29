"use server";

import type { CreateAgencyResult } from "@anar/domain/agencies";
import { revalidatePath } from "next/cache";
import { type ActionResult, actionFailure } from "@/lib/errors";
import { createAgency, resendFirstInvite } from "./server";

export async function createAgencyAction(
  _previous: ActionResult<CreateAgencyResult> | null,
  form: FormData,
): Promise<ActionResult<CreateAgencyResult>> {
  try {
    const data = await createAgency({
      name: String(form.get("name") ?? ""),
      slug: String(form.get("slug") ?? ""),
      email: String(form.get("email") ?? ""),
      staffName: String(form.get("staffName") ?? ""),
    });
    revalidatePath("/owner/agencies");
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function resendFirstInviteAction(
  agencyId: string,
  _previous: ActionResult<{ ok: true }> | null,
  _form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const data = await resendFirstInvite({ agencyId });
    revalidatePath("/owner/agencies");
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}
