import "server-only";
import {
  emptySchema,
  okSchema,
  stepUpSchema,
  type SessionList,
  sessionListSchema,
  type SessionView,
  sessionViewSchema,
  type WorkspacePage,
  workspaceListQuerySchema,
  workspacePageSchema,
} from "@anar/domain/auth";
import { cache } from "react";
import { apiRequest } from "@/lib/api/client";
import { authEnabled } from "@/lib/api/mode";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";
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
  return {
    ...readiness[screen],
    enabled: authEnabled(),
  };
}

const sessionSchema = sessionViewSchema.transform(
  (view): SessionView => ({
    ...view,
    session: {
      ...view.session,
      expiresAt: new Date(view.session.expiresAt),
      lastOtpAt: new Date(view.session.lastOtpAt),
      actingUntil:
        view.session.actingUntil === null
          ? null
          : new Date(view.session.actingUntil),
    },
    workspace:
      view.workspace.kind === "agency"
        ? {
            ...view.workspace,
            agency: {
              ...view.workspace.agency,
              createdAt: new Date(view.workspace.agency.createdAt),
            },
          }
        : view.workspace,
  }),
);

export const getSession = cache(
  async (): Promise<ActionResult<SessionView> | null> => {
    if (!authEnabled()) return null;
    try {
      return {
        ok: true,
        data: await apiRequest({ path: "/api/auth/getSession" }, sessionSchema),
      };
    } catch (error) {
      return actionFailure(error);
    }
  },
);

export async function listWorkspaces(
  query: unknown,
): Promise<ActionResult<WorkspacePage> | null> {
  if (!authEnabled()) return null;
  try {
    const parsed = workspaceListQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new AppError("validation", "Invalid workspace page.");
    return {
      ok: true,
      data: await apiRequest(
        { path: "/api/auth/listWorkspaces", query: parsed.data },
        workspacePageSchema,
      ),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function requestFreshCode() {
  if (!authEnabled())
    throw new AppError("unavailable", "Sign-in is not available yet.");
  return apiRequest(
    {
      path: "/api/auth/requestStepUp",
      method: "POST",
      body: emptySchema.parse({}),
    },
    okSchema,
  );
}

export async function verifyFreshCode(code: string) {
  if (!authEnabled())
    throw new AppError("unavailable", "Sign-in is not available yet.");
  const parsed = stepUpSchema.safeParse({ code });
  if (!parsed.success)
    throw new AppError("validation", "Enter your six-digit code.");
  return apiRequest(
    { path: "/api/auth/stepUp", method: "POST", body: parsed.data },
    okSchema,
  );
}

export async function listSessions(): Promise<ActionResult<SessionList> | null> {
  if (!getAuthReadiness("sessions").enabled) return null;
  try {
    const data = await apiRequest(
      { path: "/api/auth/listSessions" },
      sessionListSchema,
    );
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}
