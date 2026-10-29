"use server";

import { type ActionResult, AppError, actionFailure } from "@/lib/errors";
import { requirePendingAuthScreen } from "./server";
import type { AuthScreen } from "./types";

export async function submitAuthAction(
  screen: Exclude<AuthScreen, "login" | "code">,
  _previous: ActionResult<void> | null,
  _form: FormData,
): Promise<ActionResult<void>> {
  try {
    if (screen !== "invite" && screen !== "sessions")
      throw new AppError("unavailable", "This action is not available.");
    return await requirePendingAuthScreen(screen);
  } catch (error) {
    return actionFailure(error);
  }
}
