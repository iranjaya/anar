"use client";

import { useActionState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import { deactivateMemberAction } from "../actions";

export function RemoveMember({
  slug,
  memberId,
  name,
}: {
  slug: string;
  memberId: string;
  name: string;
}) {
  const [state, action, pending] = useActionState(
    deactivateMemberAction.bind(null, slug, memberId),
    null,
  );
  return (
    <div className="min-w-0 lg:col-span-3">
      <form action={action} aria-busy={pending} className="space-y-2">
        <button
          type="submit"
          disabled={pending}
          aria-label={`Remove ${name} from the team`}
          className="min-h-11 rounded-lg border border-line-strong px-4 text-sm font-semibold text-overdue disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Removing…" : "Remove from team"}
        </button>
        {state && !state.ok && (
          <p role="alert" className="text-sm text-overdue">
            {state.message}
          </p>
        )}
      </form>
      {state && !state.ok && state.error === "step_up_required" && (
        <FreshCodeForm enabled={!pending} />
      )}
    </div>
  );
}
