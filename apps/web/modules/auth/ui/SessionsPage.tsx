import { MonitorSmartphone } from "lucide-react";
import Link from "next/link";
import type { AuthReadiness } from "../types";
import { AuthForm } from "./AuthForm";

export function SessionsPage({ readiness }: { readiness: AuthReadiness }) {
  return (
    <>
      <p className="text-sm font-semibold text-brand">Your account</p>
      <h1 className="mt-2 font-display text-3xl font-bold">
        Signed-in devices
      </h1>
      <p className="mt-3 text-muted">
        Review your devices and sign out of any you no longer use.
      </p>
      <div className="mt-6 rounded-xl border border-line p-5">
        <MonitorSmartphone aria-hidden="true" className="size-6 text-muted" />
        <h2 className="mt-3 font-display text-lg font-semibold">
          Your sessions
        </h2>
        <p className="mt-2 text-sm text-muted">
          Device details will appear here when session management is available.
        </p>
      </div>
      <AuthForm screen="sessions" readiness={readiness} label="Sign out">
        <span className="sr-only">Sign out of this device</span>
      </AuthForm>
      <Link
        href="/login"
        className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4"
      >
        Back to sign in
      </Link>
    </>
  );
}
