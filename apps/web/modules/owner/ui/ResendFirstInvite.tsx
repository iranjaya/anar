"use client";

import { useActionState } from "react";
import { resendFirstInviteAction } from "../actions";

export function ResendFirstInvite({
  agencyId,
  enabled,
}: {
  agencyId: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(
    resendFirstInviteAction.bind(null, agencyId),
    null,
  );
  return (
    <form action={action} aria-busy={pending} className="space-y-2">
      <button
        type="submit"
        disabled={!enabled || pending}
        className="min-h-11 w-full rounded-lg border border-line-strong px-3 text-sm font-semibold text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
      >
        {pending ? "Sending…" : "Resend first invite"}
      </button>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-overdue">
          {state.message}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-brand">
          Invitation queued.
        </p>
      )}
    </form>
  );
}
