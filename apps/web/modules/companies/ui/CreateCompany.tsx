"use client";

import { useActionState, useState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import { companyFreshCodeAction, createCompanyAction } from "../actions";
import { InviteSuperAdmin } from "./InviteSuperAdmin";

export function CreateCompany({
  enabled,
  canInvite,
}: {
  enabled: boolean;
  canInvite: boolean;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [state, action, pending] = useActionState(createCompanyAction, null);
  if (state?.ok)
    return (
      <section className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
        <h2 className="font-display text-xl font-semibold">Company created</h2>
        <p role="status" className="mt-2 text-sm text-brand">
          {name} is ready. Invite its first Super Admin below.
        </p>
        <InviteSuperAdmin
          companyId={state.data.companyId}
          enabled={canInvite}
        />
      </section>
    );
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
      <h2 className="font-display text-xl font-semibold">Create a company</h2>
      <p className="mt-2 text-sm text-muted">
        A fresh code is required. Then invite its first Super Admin to manage
        the company.
      </p>
      <form action={action} aria-busy={pending} className="mt-5 space-y-4">
        <div>
          <label
            htmlFor="company-name"
            className="mb-2 block text-sm font-semibold"
          >
            Company name
          </label>
          <input
            id="company-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="organization"
            maxLength={160}
            required
            disabled={!enabled || pending}
            className="min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
          />
        </div>
        <div>
          <label
            htmlFor="company-slug"
            className="mb-2 block text-sm font-semibold"
          >
            Company slug
          </label>
          <input
            id="company-slug"
            name="slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            minLength={3}
            maxLength={63}
            pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]"
            required
            disabled={!enabled || pending}
            aria-describedby="slug-help"
            className="min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
          />
          <p id="slug-help" className="mt-2 text-xs text-muted">
            3–63 lowercase letters, numbers or hyphens. For example:
            sundar-heights.
          </p>
        </div>
        <p className="text-sm text-muted">
          Country: Nepal · Timezone: Asia/Kathmandu
        </p>
        {state && !state.ok && (
          <p role="alert" className="text-sm text-overdue">
            {state.message}
          </p>
        )}
        <button
          type="submit"
          disabled={!enabled || pending}
          className="min-h-12 w-full rounded-xl bg-brand px-5 font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create company"}
        </button>
      </form>
      {state && !state.ok && state.error === "step_up_required" && (
        <FreshCodeForm
          enabled={enabled && !pending}
          submit={companyFreshCodeAction}
        />
      )}
    </section>
  );
}
