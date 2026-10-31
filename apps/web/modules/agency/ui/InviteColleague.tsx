"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import { inviteStaffAction } from "../actions";

export function InviteColleague({ enabled }: { enabled: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [state, action, pending] = useActionState(inviteStaffAction, null);
  useEffect(() => {
    if (state?.ok) {
      setName("");
      setEmail("");
    }
  }, [state]);
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
      <h2 className="font-display text-xl font-semibold">Invite a colleague</h2>
      <p className="mt-2 text-sm text-muted">
        They’ll join your agency’s staff after accepting. A fresh code is
        required to send an invitation.
      </p>
      {!enabled && (
        <p className="mt-3 text-sm text-muted">
          Inviting colleagues is currently unavailable.
        </p>
      )}
      <form action={action} aria-busy={pending} className="mt-5 space-y-4">
        <div>
          <label
            htmlFor="colleague-name"
            className="mb-2 block text-sm font-semibold"
          >
            Name
          </label>
          <input
            id="colleague-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            maxLength={120}
            required
            disabled={!enabled || pending}
            className="min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
          />
        </div>
        <div>
          <label
            htmlFor="colleague-email"
            className="mb-2 block text-sm font-semibold"
          >
            Email
          </label>
          <input
            id="colleague-email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            disabled={!enabled || pending}
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
            Invitation queued.{" "}
            <Link
              href="/agency/invites"
              className="underline underline-offset-4"
            >
              View pending invitations
            </Link>
          </p>
        )}
        <button
          type="submit"
          disabled={!enabled || pending}
          className="min-h-12 w-full rounded-xl bg-brand px-5 font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Sending…" : "Invite colleague"}
        </button>
      </form>
      {state && !state.ok && state.error === "step_up_required" && (
        <FreshCodeForm enabled={enabled && !pending} />
      )}
    </section>
  );
}
