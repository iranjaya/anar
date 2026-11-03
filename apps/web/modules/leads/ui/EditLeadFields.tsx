"use client";

import type { UpdateLeadFieldsInput } from "@anar/domain/leads";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { Field } from "@/modules/settings/types";
import { updateLeadFieldsAction } from "../editActions";
import type { Lead } from "../types";

type Draft = Record<string, string>;
const input =
  "mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-3 text-base";
const contact = [
  ["fullName", "Name", "text"],
  ["phoneRaw", "Phone", "tel"],
  ["email", "Email", "email"],
] as const;

export function EditLeadFields({
  slug,
  lead,
  fields,
}: {
  slug: string;
  lead: Pick<Lead, "id" | "fullName" | "phoneRaw" | "email" | "custom">;
  fields: Field[];
}) {
  const router = useRouter();
  const id = useId();
  const start = (): Draft => ({
    fullName: lead.fullName ?? "",
    phoneRaw: lead.phoneRaw ?? "",
    email: lead.email ?? "",
    ...Object.fromEntries(
      fields.map((field) => [field.key, String(lead.custom[field.key] ?? "")]),
    ),
  });
  const [draft, setDraft] = useState(start);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const initial = start();

  function changes(): UpdateLeadFieldsInput {
    const text = (value: string) => value.trim() || null;
    const out: UpdateLeadFieldsInput = { leadId: lead.id };
    for (const [key] of contact)
      if (draft[key] !== initial[key]) out[key] = text(draft[key]);
    const custom: Record<string, string | number | null> = {};
    for (const field of fields) {
      if (draft[field.key] === initial[field.key]) continue;
      const value = text(draft[field.key]);
      custom[field.key] =
        field.type === "number" && value !== null ? Number(value) : value;
    }
    if (Object.keys(custom).length) out.custom = custom;
    return out;
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await updateLeadFieldsAction(slug, changes());
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  const set = (key: string) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <details className="rounded-2xl border border-line bg-surface px-5">
      <summary className="min-h-11 cursor-pointer py-3 font-display text-xl font-semibold focus-visible:outline-2 focus-visible:outline-brand">
        Edit details
      </summary>
      <form onSubmit={save} className="space-y-4 border-t border-line py-4">
        {contact.map(([key, label, type]) => (
          <label key={key} className="block text-sm font-semibold">
            {label}
            <input
              type={type}
              value={draft[key]}
              onChange={(event) => set(key)(event.currentTarget.value)}
              className={input}
            />
          </label>
        ))}
        {fields.map((field) => (
          <div key={field.key} className="text-sm font-semibold">
            <label htmlFor={`${id}-${field.key}`}>{field.label}</label>
            {field.type === "dropdown" ? (
              <select
                id={`${id}-${field.key}`}
                value={draft[field.key]}
                onChange={(event) => set(field.key)(event.currentTarget.value)}
                className={input}
              >
                <option value="">Not answered</option>
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`${id}-${field.key}`}
                type={field.type === "text" ? "text" : field.type}
                value={draft[field.key]}
                onChange={(event) => set(field.key)(event.currentTarget.value)}
                className={input}
              />
            )}
          </div>
        ))}
        {error && (
          <p id={`${id}-error`} role="alert" className="text-sm text-overdue">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-h-12 w-full rounded-xl bg-brand px-4 font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </form>
    </details>
  );
}
