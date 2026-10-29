"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useActionState, useEffect } from "react";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";
import { requestOtp, verifyOtp } from "../browser";
import type { AuthReadiness } from "../types";

type SignInResult = ActionResult<{
  redirectTo: "/login/code" | "/workspaces";
}>;

export function SignInForm({
  screen,
  readiness,
  children,
}: {
  screen: "login" | "code";
  readiness: AuthReadiness;
  children: ReactNode;
}) {
  const [state, action, pending] = useActionState<
    SignInResult | null,
    FormData
  >(async (_previous, form) => {
    try {
      if (!readiness.enabled)
        throw new AppError("unavailable", readiness.message);
      const email = String(form.get("email") ?? "");
      if (screen === "login") {
        await requestOtp({ email });
        return { ok: true, data: { redirectTo: "/login/code" } };
      }
      const result = await verifyOtp({
        email,
        code: String(form.get("code") ?? ""),
      });
      return { ok: true, data: result };
    } catch (error) {
      return actionFailure(error);
    }
  }, null);
  const router = useRouter();
  const label = screen === "login" ? "Send code" : "Verify and sign in";
  useEffect(() => {
    if (state?.ok) {
      router.replace(state.data.redirectTo);
      router.refresh();
    }
  }, [state, router]);
  return (
    <form action={action} className="mt-6 space-y-5" aria-busy={pending}>
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
        disabled={!readiness.enabled || pending}
        className="min-h-14 w-full rounded-xl bg-brand px-5 font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Please wait…" : label}
      </button>
    </form>
  );
}
