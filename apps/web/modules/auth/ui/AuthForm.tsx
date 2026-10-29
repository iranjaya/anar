"use client";

import { type ReactNode, useActionState } from "react";
import type { ActionResult } from "@/lib/errors";
import { submitAuthAction } from "../actions";
import type { AuthReadiness, AuthScreen } from "../types";

export function AuthForm({
  screen,
  readiness,
  children,
  label,
  blocked = false,
  token,
}: {
  screen: Exclude<AuthScreen, "login" | "code">;
  readiness: AuthReadiness;
  children: ReactNode;
  label: string;
  blocked?: boolean;
  token?: string;
}) {
  const [state, action, pending] = useActionState<
    ActionResult<void> | null,
    FormData
  >((previous, form: FormData) => {
    if (token) form.set("token", token);
    return submitAuthAction(screen, previous, form);
  }, null);
  return (
    <form action={action} className="mt-6 space-y-5">
      {children}
      {!readiness.enabled && (
        <p
          role="status"
          className="rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand"
        >
          {readiness.message}
        </p>
      )}
      {state && !state.ok && (
        <p role="alert" className="text-sm text-overdue">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={!readiness.enabled || blocked || pending}
        className="min-h-14 w-full rounded-xl bg-brand px-5 font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Please wait…" : label}
      </button>
    </form>
  );
}
