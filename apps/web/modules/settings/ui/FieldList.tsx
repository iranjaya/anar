"use client";

import type { Field } from "@anar/domain/settings";
import { useActionState, useState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import { archiveFieldAction, updateFieldAction } from "../actions";
import { type Choice, DefinitionInputs, inputClass } from "./DefinitionInputs";

export function FieldList({ slug, fields }: { slug: string; fields: Field[] }) {
  const active = fields.filter((field) => field.archivedAt === null);
  const archived = fields.filter((field) => field.archivedAt !== null);
  return (
    <>
      <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
        {active.map((field) => (
          <FieldRow key={field.id} slug={slug} field={field} />
        ))}
      </ul>
      {archived.length > 0 && (
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-muted">
            Archived ({archived.length})
          </summary>
          <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
            {archived.map((field) => (
              <li key={field.id} className="min-w-0 px-5 py-4">
                <p className="font-semibold wrap-break-word">{field.label}</p>
                <p className="font-mono text-sm text-muted wrap-break-word">
                  {field.key}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function FieldRow({ slug, field }: { slug: string; field: Field }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="min-w-0 px-5 py-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold wrap-break-word">{field.label}</p>
          <p className="text-sm text-muted wrap-break-word">
            <span className="font-mono">{field.key}</span> ·{" "}
            {field.type === "dropdown"
              ? `${field.options?.length ?? 0} choices`
              : field.type}
          </p>
        </div>
        {!field.isSystem && (
          <button
            type="button"
            aria-expanded={editing}
            onClick={() => setEditing(!editing)}
            className="min-h-11 rounded-xl border border-line-strong px-4 text-sm font-semibold"
          >
            {editing ? "Close" : "Edit"}
          </button>
        )}
      </div>
      {editing && <FieldEditor slug={slug} field={field} />}
    </li>
  );
}

function FieldEditor({ slug, field }: { slug: string; field: Field }) {
  const [label, setLabel] = useState(field.label);
  const [type, setType] = useState<string>(field.type);
  const [choices, setChoices] = useState<Choice[]>(() =>
    (field.options ?? [{ value: "", label: "" }]).map((option) => ({
      id: crypto.randomUUID(),
      ...option,
    })),
  );
  const [saved, save, saving] = useActionState(
    updateFieldAction.bind(null, slug, field.id),
    null,
  );
  const [archived, archive, archiving] = useActionState(
    archiveFieldAction.bind(null, slug, field.id),
    null,
  );
  const pending = saving || archiving;
  const stale = [saved, archived].some(
    (state) => state && !state.ok && state.error === "step_up_required",
  );
  const id = `field-${field.id}`;
  return (
    <div className="mt-4 space-y-4">
      <form action={save} aria-busy={saving} className="space-y-4">
        <div>
          <label
            htmlFor={`${id}-label`}
            className="mb-2 block text-sm font-semibold"
          >
            Name
          </label>
          <input
            id={`${id}-label`}
            name="label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={120}
            required
            disabled={pending}
            className={inputClass}
          />
        </div>
        <DefinitionInputs
          id={id}
          pending={pending}
          type={type}
          onType={setType}
          choices={choices}
          onChoices={setChoices}
        />
        <p className="text-sm text-muted">
          Once leads have answers, the type and codes stay. You can still rename
          labels and add codes.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="min-h-12 rounded-xl bg-brand px-5 font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved?.ok && (
            <p role="status" className="text-sm text-brand">
              Saved.
            </p>
          )}
          {saved && !saved.ok && (
            <p role="alert" className="text-sm text-overdue">
              {saved.message}
            </p>
          )}
        </div>
      </form>
      <form
        action={archive}
        aria-busy={archiving}
        className="border-t border-line pt-4"
      >
        <p className="text-sm text-muted">
          Archiving hides this field from forms. Answers already stored on leads
          stay.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="mt-3 min-h-11 rounded-xl border border-line-strong px-4 text-sm font-semibold text-overdue disabled:opacity-50"
        >
          {archiving ? "Archiving…" : "Archive field"}
        </button>
        {archived && !archived.ok && (
          <p role="alert" className="mt-2 text-sm text-overdue">
            {archived.message}
          </p>
        )}
      </form>
      {stale && <FreshCodeForm enabled={!pending} />}
    </div>
  );
}
