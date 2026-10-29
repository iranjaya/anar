"use client";

import { useActionState } from "react";
import { resendStaffInviteAction } from "../actions";
import { FreshCodeForm } from "./FreshCodeForm";

export function ResendInvite({
  inviteId,
  enabled,
}: {
  inviteId: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(
    resendStaffInviteAction.bind(null, inviteId),
    null,
  );
  return (
    <div className="min-w-0">
      <form action={action} aria-busy={pending} className="space-y-2">
        <button
          type="submit"
          disabled={!enabled || pending}
          className="min-h-11 rounded-lg border border-line-strong px-4 text-sm font-semibold text-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Sending…" : "Resend invite"}
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
      {state && !state.ok && state.error === "step_up_required" && (
        <FreshCodeForm enabled={enabled && !pending} />
      )}
    </div>
  );
}
