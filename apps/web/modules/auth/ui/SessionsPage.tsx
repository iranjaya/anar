"use client";

import type { SessionList } from "@anar/domain/auth";
import { MonitorSmartphone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";
import { logout, revokeSession } from "../browser";
import type { AuthReadiness } from "../types";

export function SessionsPage({
  readiness,
  result,
}: {
  readiness: AuthReadiness;
  result: ActionResult<SessionList> | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<
    ActionResult<{ signedOut: boolean }> | null,
    FormData
  >(async (_previous, form) => {
    try {
      if (!readiness.enabled)
        throw new AppError("unavailable", readiness.message);
      if (form.get("intent") === "logout") {
        await logout();
        return { ok: true, data: { signedOut: true } };
      }
      const sessionId = String(form.get("sessionId") ?? "");
      await revokeSession({ sessionId });
      const signedOut = !!(
        result?.ok &&
        result.data.some(
          (session) => session.id === sessionId && session.current,
        )
      );
      return { ok: true, data: { signedOut } };
    } catch (error) {
      return actionFailure(error);
    }
  }, null);
  useEffect(() => {
    if (!state?.ok) return;
    if (state.data.signedOut) router.replace("/login");
    router.refresh();
  }, [state, router]);
  const disabled =
    !readiness.enabled || pending || !!(state?.ok && state.data.signedOut);
  return (
    <>
      <p className="text-sm font-semibold text-brand">Your account</p>
      <h1 className="mt-2 font-display text-3xl font-bold">
        Signed-in devices
      </h1>
      <p className="mt-3 text-muted">
        Review your devices and sign out of any you no longer use.
      </p>
      <form action={action} className="mt-6 space-y-5" aria-busy={pending}>
        {!readiness.enabled && (
          <p
            role="status"
            className="rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand"
          >
            {readiness.message}
          </p>
        )}
        {readiness.enabled && result && !result.ok && (
          <div role="alert" className="text-sm text-overdue">
            <p>{result.message}</p>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="min-h-11 font-semibold underline underline-offset-4"
            >
              Try again
            </button>
          </div>
        )}
        {readiness.enabled &&
          result?.ok &&
          (result.data.length === 0 ? (
            <p
              role="status"
              className="rounded-xl border border-line p-5 text-sm text-muted"
            >
              No active devices.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {result.data.map((session) => (
                <li
                  key={session.id}
                  className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between lg:gap-4"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <MonitorSmartphone
                      aria-hidden="true"
                      className="mt-1 size-5 shrink-0 text-muted"
                    />
                    <div className="min-w-0">
                      <p className="break-words font-semibold">
                        {session.deviceLabel}
                      </p>
                      {session.current && (
                        <p className="mt-1 text-xs font-semibold text-brand">
                          This device
                        </p>
                      )}
                      <p className="mt-1 text-sm text-muted">
                        Last active{" "}
                        <time dateTime={session.lastSeenAt}>
                          {new Date(session.lastSeenAt).toLocaleString(
                            "en-GB",
                            {
                              timeZone: "UTC",
                              dateStyle: "medium",
                              timeStyle: "short",
                            },
                          )}{" "}
                          UTC
                        </time>
                      </p>
                    </div>
                  </div>
                  <button
                    type="submit"
                    name="sessionId"
                    value={session.id}
                    disabled={disabled}
                    aria-label={`Sign out ${session.deviceLabel}${session.current ? " (this device)" : ""}`}
                    className="min-h-11 shrink-0 rounded-lg border border-line px-4 text-sm font-semibold text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Sign out
                  </button>
                </li>
              ))}
            </ul>
          ))}
        {state && !state.ok && (
          <p role="alert" className="text-sm text-overdue">
            {state.message}
          </p>
        )}
        {state?.ok && !state.data.signedOut && (
          <p role="status" className="text-sm text-brand">
            Device signed out.
          </p>
        )}
        {pending && (
          <p role="status" className="text-sm text-muted">
            Signing out…
          </p>
        )}
        <button
          type="submit"
          name="intent"
          value="logout"
          disabled={disabled}
          className="min-h-14 w-full rounded-xl bg-brand px-5 font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          Sign out of this device
        </button>
      </form>
      <Link
        href="/login"
        className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4"
      >
        Back to sign in
      </Link>
    </>
  );
}
