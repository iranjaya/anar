"use client";

import { useActionState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import { resendInviteAction } from "../actions";

export function ResendInvite({
  slug,
  inviteId,
}: {
  slug: string;
  inviteId: string;
}) {
  const [state, action, pending] = useActionState(
    resendInviteAction.bind(null, slug, inviteId),
    null,
  );
  return (
    <div className="mt-3 min-w-0">
      <form action={action} aria-busy={pending} className="space-y-2">
        <button
          type="submit"
          disabled={pending}
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
        <FreshCodeForm enabled={!pending} />
      )}
    </div>
  );
}
