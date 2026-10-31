"use client";

import { useActionState } from "react";
import { leaveAgencyCompanyAction } from "../actions";

export function ActingBanner({
  company,
  reason,
  until,
}: {
  company: string;
  reason: string;
  until: string;
}) {
  const [state, action, pending] = useActionState(
    leaveAgencyCompanyAction,
    null,
  );
  return (
    <section
      aria-label="Agency staff access"
      className="border-b border-line bg-brand-soft px-4 py-3"
    >
      <div className="mx-auto flex max-w-7xl min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 text-sm">
          <p className="font-semibold">
            You are in {company} as agency staff until {until}.
          </p>
          <p className="mt-1 text-muted wrap-break-word">Reason: {reason}</p>
        </div>
        <form action={action} aria-busy={pending} className="shrink-0">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold text-brand disabled:opacity-50"
          >
            {pending ? "Leaving…" : "Leave company"}
          </button>
          {state && !state.ok && (
            <p role="alert" className="mt-2 text-sm text-overdue">
              {state.message}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
