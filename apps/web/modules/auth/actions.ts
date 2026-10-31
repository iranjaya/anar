"use server";

import { type ActionResult, AppError, actionFailure } from "@/lib/errors";
import { requestFreshCode, verifyFreshCode } from "./server";

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
