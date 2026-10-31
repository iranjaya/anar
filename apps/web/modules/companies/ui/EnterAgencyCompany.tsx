"use client";

import { useActionState, useId, useState } from "react";
import { enterAgencyCompanyAction } from "../actions";

export function EnterAgencyCompany({
  companyId,
  slug,
  name,
}: {
  companyId: string;
  slug: string;
  name: string;
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState(
    enterAgencyCompanyAction.bind(null, { companyId, slug }),
    null,
  );
  return (
    <form
      action={action}
      aria-busy={pending}
      className="mt-4 grid min-w-0 gap-3 border-t border-line pt-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"
    >
      <div className="min-w-0">
        <label htmlFor={id} className="mb-2 block text-sm font-semibold">
          Reason for entering {name}
        </label>
        <input
          id={id}
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          required
          disabled={pending}
          className="min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="min-h-12 rounded-xl bg-brand px-5 font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Entering…" : "Enter company"}
      </button>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-overdue lg:col-span-2">
          {state.message}
        </p>
      )}
      <p className="text-xs text-muted lg:col-span-2">
        Access lasts eight hours. The company sees your reason.
      </p>
    </form>
  );
}
