"use client";

import { useActionState, useEffect, useState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import { inviteAdminAction } from "../actions";

export function InviteAdmin({ slug }: { slug: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [state, action, pending] = useActionState(
    inviteAdminAction.bind(null, slug),
    null,
  );
  useEffect(() => {
    if (state?.ok) {
      setName("");
      setEmail("");
    }
  }, [state]);
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
      <h2 className="font-display text-xl font-semibold">Invite an Admin</h2>
      <p className="mt-2 text-sm text-muted">
        Admins work the leads given to them. A fresh code is required to send an
        invitation.
      </p>
      <form action={action} aria-busy={pending} className="mt-5 space-y-4">
        <div>
          <label
            htmlFor="admin-name"
            className="mb-2 block text-sm font-semibold"
          >
            Admin name
          </label>
          <input
            id="admin-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            maxLength={120}
            required
            disabled={pending}
            className="min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
          />
        </div>
        <div>
          <label
            htmlFor="admin-email"
            className="mb-2 block text-sm font-semibold"
          >
            Admin email
          </label>
          <input
            id="admin-email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
            required
            disabled={pending}
            className="min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
          />
        </div>
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
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 w-full rounded-xl bg-brand px-5 font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Sending…" : "Invite Admin"}
        </button>
      </form>
      {state && !state.ok && state.error === "step_up_required" && (
        <FreshCodeForm enabled={!pending} />
      )}
    </section>
  );
}
