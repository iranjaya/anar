"use client";

import Link from "next/link";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { type ActionResult, actionFailure } from "@/lib/errors";
import { acceptInvite, inspectInvite } from "../browser";
import type { AuthReadiness } from "../types";
import { useAuthEmail } from "./AuthEmail";
import { AuthField } from "./AuthField";

type Preview = ActionResult<Awaited<ReturnType<typeof inspectInvite>>>;
type Acceptance = ActionResult<Awaited<ReturnType<typeof acceptInvite>>>;

export function InvitePage({ readiness }: { readiness: AuthReadiness }) {
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [, setEmail] = useAuthEmail();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const inspect = useCallback(async (secret: string) => {
    setLoading(true);
    try {
      const data = await inspectInvite(secret);
      setPreview({ ok: true, data });
      setName(data.name);
    } catch (error) {
      setPreview(actionFailure(error));
    } finally {
      setLoading(false);
    }
  }, []);
  const [state, action, pending] = useActionState<Acceptance | null, FormData>(
    async () => {
      if (!token || !preview?.ok || !readiness.enabled) return null;
      try {
        const data = await acceptInvite(token, name);
        setToken(null);
        setEmail(preview.data.email);
        return { ok: true, data };
      } catch (error) {
        return actionFailure(error);
      }
    },
    null,
  );
  const read = useRef(false);
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const secret = fragment.get("token") || "";
    setToken(secret);
    if (window.location.hash)
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    if (secret && readiness.enabled) void inspect(secret);
  }, [readiness.enabled, inspect]);
  return (
    <>
      <p className="text-sm font-semibold text-brand">You’re invited</p>
      <h1 className="mt-2 font-display text-3xl font-bold">Join your team</h1>
      <p className="mt-3 text-muted">
        Accept your invitation, then confirm your email with a sign-in code.
      </p>
      {!readiness.enabled && (
        <p role="status" className="mt-6 text-brand">
          {readiness.message}
        </p>
      )}
      {state?.ok ? (
        <div className="mt-6 space-y-4">
          <p role="status">
            Invitation accepted. Sign in with your invited email.
          </p>
          <Link
            href="/login"
            className="inline-flex min-h-12 items-center rounded-xl bg-brand px-5 font-semibold text-surface"
          >
            Continue to sign in
          </Link>
        </div>
      ) : token === "" ? (
        <p
          role="alert"
          className="mt-6 rounded-xl bg-overdue-soft px-4 py-3 text-sm text-overdue"
        >
          This invitation link is missing. Open the original invitation from
          your email again.
        </p>
      ) : preview?.ok ? (
        <form action={action} aria-busy={pending} className="mt-6 space-y-5">
          <div className="rounded-xl bg-brand-soft p-4 wrap-break-word">
            <p className="font-semibold">
              {preview.data.companyName ?? preview.data.agencyName}
            </p>
            <p className="mt-2 text-sm">Invited email: {preview.data.email}</p>
          </div>
          <AuthField
            id="invite-name"
            name="name"
            label="Your name"
            autoComplete="name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
          />
          {state && !state.ok && (
            <p role="alert" className="text-sm text-overdue">
              {state.message}
            </p>
          )}
          <button
            type="submit"
            disabled={pending || !readiness.enabled}
            className="min-h-14 w-full rounded-xl bg-brand px-5 font-semibold text-surface disabled:opacity-50"
          >
            {pending ? "Accepting…" : "Accept invitation"}
          </button>
        </form>
      ) : preview && !preview.ok ? (
        <div className="mt-6">
          <p role="alert" className="text-sm text-overdue">
            {preview.message}
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={() => token && void inspect(token)}
            className="mt-3 min-h-11 font-semibold text-brand"
          >
            Try again
          </button>
        </div>
      ) : (
        readiness.enabled && (
          <p role="status" className="mt-6 text-muted">
            Checking invitation…
          </p>
        )
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
