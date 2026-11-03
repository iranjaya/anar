"use client";

import { fieldKeyFromLabel } from "@anar/domain/settings";
import { useActionState, useEffect, useState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import { createFieldAction } from "../actions";
import {
  blankChoice,
  type Choice,
  DefinitionInputs,
  inputClass,
} from "./DefinitionInputs";

export function FieldForm({ slug }: { slug: string }) {
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [type, setType] = useState("dropdown");
  const [choices, setChoices] = useState<Choice[]>(() => [blankChoice()]);
  const [state, action, pending] = useActionState(
    createFieldAction.bind(null, slug),
    null,
  );
  useEffect(() => {
    if (state?.ok) {
      setLabel("");
      setKey("");
      setChoices([blankChoice()]);
    }
  }, [state]);
  return (
    <section
      aria-labelledby="add-field-heading"
      className="mt-4 rounded-2xl border border-line bg-surface p-5 lg:p-6"
    >
      <h3 id="add-field-heading" className="font-display text-lg font-semibold">
        Add a field
      </h3>
      <p className="mt-1 text-sm text-muted">
        The key matches import columns and cannot change later. A fresh code is
        required to save.
      </p>
      <form action={action} aria-busy={pending} className="mt-4 space-y-4">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <label
              htmlFor="field-label"
              className="mb-2 block text-sm font-semibold"
            >
              Name
            </label>
            <input
              id="field-label"
              name="label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={120}
              required
              disabled={pending}
              className={inputClass}
            />
          </div>
          <div className="min-w-0">
            <label
              htmlFor="field-key"
              className="mb-2 block text-sm font-semibold"
            >
              Key (optional)
            </label>
            <input
              id="field-key"
              name="key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={fieldKeyFromLabel(label) ?? "lower_case_key"}
              maxLength={64}
              autoComplete="off"
              disabled={pending}
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>
        <DefinitionInputs
          id="field"
          pending={pending}
          type={type}
          onType={setType}
          choices={choices}
          onChoices={setChoices}
        />
        {state && !state.ok && (
          <p role="alert" className="text-sm text-overdue">
            {state.message}
          </p>
        )}
        {state?.ok && (
          <p role="status" className="text-sm text-brand">
            Field added.
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 w-full rounded-xl bg-brand px-5 font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
        >
          {pending ? "Saving…" : "Add field"}
        </button>
      </form>
      {state && !state.ok && state.error === "step_up_required" && (
        <FreshCodeForm enabled={!pending} />
      )}
    </section>
  );
}
