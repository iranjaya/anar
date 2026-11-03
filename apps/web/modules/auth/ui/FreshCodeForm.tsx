"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { freshCodeAction } from "../actions";

export function FreshCodeForm({
  enabled,
  onVerified,
}: {
  enabled: boolean;
  onVerified?: () => void;
}) {
  const id = useId();
  const [code, setCode] = useState("");
  const [state, action, pending] = useActionState(freshCodeAction, null);
  const notified = useRef<typeof state>(null);
  useEffect(() => {
    if (state?.ok && state.data.verified && notified.current !== state) {
      notified.current = state;
      onVerified?.();
    }
  }, [state, onVerified]);
  return (
    <section
      aria-busy={pending}
      className="mt-4 space-y-3 rounded-xl border border-line bg-brand-soft p-4"
    >
      <p className="text-sm font-semibold">Confirm with a fresh code</p>
      <p className="text-sm text-muted">
        Send a code to your signed-in email, verify it here, then retry your
        action. Your details stay in the form.
      </p>
      <form action={action}>
        <input type="hidden" name="intent" value="request" />
        <button
          type="submit"
          disabled={!enabled || pending}
          className="min-h-11 rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold text-brand disabled:opacity-50"
        >
          Send fresh code
        </button>
      </form>
      <form action={action} className="space-y-3">
        <input type="hidden" name="intent" value="verify" />
        <label htmlFor={id} className="block text-sm font-semibold">
          Six-digit code
        </label>
        <input
          id={id}
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          disabled={!enabled || pending}
          className="min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 font-mono outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
        <button
          type="submit"
          disabled={!enabled || pending}
          className="min-h-11 rounded-lg bg-brand px-4 text-sm font-semibold text-surface disabled:opacity-50"
        >
          {pending ? "Please wait…" : "Verify code"}
        </button>
      </form>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-overdue">
          {state.message}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-brand">
          {state.data.verified
            ? "Code verified. Retry your action."
            : "Code requested. Check your email."}
        </p>
      )}
    </section>
  );
}
