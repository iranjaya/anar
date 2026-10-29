import "server-only";
import { AppError } from "@/lib/errors";
import type { AuthReadiness, AuthScreen } from "./types";

const readiness: Record<AuthScreen, AuthReadiness> = {
  login: {
    enabled: false,
    message: "Sign-in is not available yet. Please try again later.",
  },
  code: {
    enabled: false,
    message: "Code verification is not available yet. Please try again later.",
  },
  invite: {
    enabled: false,
    message:
      "Invitation acceptance is not available yet. Please try again later.",
  },
  sessions: {
    enabled: false,
    message:
      "Device information is currently unavailable. No sessions have been loaded.",
  },
};

export function getAuthReadiness(screen: AuthScreen): AuthReadiness {
  return readiness[screen];
}

export async function requirePendingAuthScreen(
  screen: Exclude<AuthScreen, "login" | "code">,
): Promise<never> {
  throw new AppError("unavailable", getAuthReadiness(screen).message);
}
