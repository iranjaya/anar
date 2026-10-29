"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AuthReadiness } from "../types";
import { AuthField } from "./AuthField";
import { AuthForm } from "./AuthForm";

export function InvitePage({ readiness }: { readiness: AuthReadiness }) {
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState("");
  const read = useRef(false);
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    setToken(fragment.get("token") || "");
    if (window.location.hash)
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
  }, []);
  return (
    <>
      <p className="text-sm font-semibold text-brand">You’re invited</p>
      <h1 className="mt-2 font-display text-3xl font-bold">Join your team</h1>
      <p className="mt-3 text-muted">
        Accept your invitation, then confirm your email with a sign-in code.
      </p>
      {token === "" ? (
        <p
          role="alert"
          className="mt-6 rounded-xl bg-overdue-soft px-4 py-3 text-sm text-overdue"
        >
          This invitation link is missing. Open the original invitation from
          your email again.
        </p>
      ) : (
        <AuthForm
          screen="invite"
          readiness={readiness}
          label="Accept invitation"
          blocked={!token}
          token={token ?? undefined}
        >
          <AuthField
            id="invite-name"
            name="name"
            label="Your name"
            autoComplete="name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="text-sm text-muted">
            We’ll show your company and invited email after the invitation can
            be checked.
          </p>
        </AuthForm>
      )}
      <Link
        href="/login"
        className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4"
      >
        Already joined? Sign in
      </Link>
    </>
  );
}
