"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import { createAgencyAction } from "../actions";

const empty = { name: "", slug: "", staffName: "", email: "" };
const fields = [
  {
    name: "name",
    label: "Agency name",
    type: "text",
    maxLength: 160,
    autoComplete: "organization",
  },
  {
    name: "slug",
    label: "Agency slug",
    type: "text",
    maxLength: 63,
    autoComplete: "off",
  },
  {
    name: "staffName",
    label: "First staff name",
    type: "text",
    maxLength: 120,
    autoComplete: "name",
  },
  {
    name: "email",
    label: "First staff email",
    type: "email",
    autoComplete: "email",
  },
] as const;

export function CreateAgencyForm({ enabled }: { enabled: boolean }) {
  const [values, setValues] = useState(empty);
  const [state, action, pending] = useActionState(createAgencyAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      setValues(empty);
      router.replace("/owner/agencies");
    }
  }, [state, router]);
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
      <h2 className="font-display text-xl font-semibold">Create agency</h2>
      <p className="mt-2 text-sm text-muted">
        Invite the first staff member. The agency stays pending until they
        accept.
      </p>
      <form action={action} aria-busy={pending} className="mt-5 space-y-4">
        {fields.map(({ label, ...field }) => (
          <div key={field.name}>
            <label
              htmlFor={`agency-${field.name}`}
              className="mb-2 block text-sm font-semibold"
            >
              {label}
            </label>
            <input
              {...field}
              id={`agency-${field.name}`}
              required
              disabled={!enabled || pending}
              value={values[field.name]}
              onChange={(event) =>
                setValues({ ...values, [field.name]: event.target.value })
              }
              {...(field.name === "slug"
                ? {
                    minLength: 3,
                    pattern: "[a-z0-9][a-z0-9-]*[a-z0-9]",
                    autoCapitalize: "none",
                    spellCheck: false,
                    "aria-describedby": "agency-slug-hint",
                  }
                : {})}
              className="min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 text-base outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 disabled:opacity-50"
            />
            {field.name === "slug" && (
              <p id="agency-slug-hint" className="mt-2 text-xs text-muted">
                3–63 lowercase letters, numbers or hyphens. Start and end with a
                letter or number.
              </p>
            )}
          </div>
        ))}
        {state && !state.ok && (
          <p role="alert" className="text-sm text-overdue">
            {state.message}
          </p>
        )}
        {state?.ok && (
          <p role="status" className="text-sm text-brand">
            Agency created. First staff invitation queued.
          </p>
        )}
        <button
          type="submit"
          disabled={!enabled || pending}
          className="min-h-12 w-full rounded-xl bg-brand px-5 font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create and invite"}
        </button>
      </form>
      {state && !state.ok && state.error === "step_up_required" && (
        <FreshCodeForm enabled={enabled && !pending} />
      )}
    </section>
  );
}
