"use client";

import { useActionState, useId, useState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import { inviteSuperAdminAction } from "../actions";

export function InviteSuperAdmin({
  companyId,
  enabled,
}: {
  companyId: string;
  enabled: boolean;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [state, action, pending] = useActionState(
    inviteSuperAdminAction.bind(null, companyId),
    null,
  );
  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="font-semibold">Invite first Super Admin</h3>
      <p className="mt-2 text-sm text-muted">
        They’ll manage this company after accepting. A fresh code is required.
      </p>
      {state?.ok ? (
        <p role="status" className="mt-4 text-sm text-brand">
          Invitation queued. They’ll receive an email with an acceptance link.
        </p>
      ) : (
        <form
          action={action}
          aria-busy={pending}
          className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2"
        >
          <div>
            <label
              htmlFor={`${id}-name`}
              className="mb-2 block text-sm font-semibold"
            >
              Super Admin name
            </label>
            <input
              id={`${id}-name`}
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              required
              maxLength={120}
              disabled={!enabled || pending}
              className="min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
            />
          </div>
          <div>
            <label
              htmlFor={`${id}-email`}
              className="mb-2 block text-sm font-semibold"
            >
              Super Admin email
            </label>
            <input
              id={`${id}-email`}
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
              required
              disabled={!enabled || pending}
              className="min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
            />
          </div>
          {state && !state.ok && (
            <p role="alert" className="text-sm text-overdue lg:col-span-2">
              {state.message}
            </p>
          )}
          <button
            type="submit"
            disabled={!enabled || pending}
            className="min-h-12 rounded-xl bg-brand px-5 font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50 lg:col-span-2"
          >
            {pending ? "Sending…" : "Invite Super Admin"}
          </button>
        </form>
      )}
      {state && !state.ok && state.error === "step_up_required" && (
        <FreshCodeForm enabled={enabled && !pending} />
      )}
    </div>
  );
}
