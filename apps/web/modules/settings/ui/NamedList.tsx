"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/errors";
import { FreshCodeForm } from "@/modules/auth/components";
import { inputClass } from "./DefinitionInputs";

type Saved = ActionResult<{ ok: true }> | null;
type Row = {
  id: string;
  name: string;
  flag?: boolean;
  archivedAt: Date | null;
};
type Props = {
  slug: string;
  noun: string;
  rows: Row[];
  flagLabel?: string;
  save(
    slug: string,
    id: string | null,
    previous: Saved,
    form: FormData,
  ): Promise<Saved>;
  archive(
    slug: string,
    id: string,
    previous: Saved,
    form: FormData,
  ): Promise<Saved>;
};

export function NamedList({ rows, ...props }: Props) {
  const active = rows.filter((row) => row.archivedAt === null);
  const archived = rows.filter((row) => row.archivedAt !== null);
  return (
    <>
      <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
        {active.map((row) => (
          <li key={row.id} className="min-w-0 px-5 py-4">
            <NamedRow row={row} {...props} last={active.length === 1} />
          </li>
        ))}
      </ul>
      <section className="mt-4 rounded-2xl border border-line bg-surface p-5">
        <h3 className="font-display text-lg font-semibold">
          Add a {props.noun}
        </h3>
        <NamedRow key={active.length} row={null} {...props} last={false} />
      </section>
      {archived.length > 0 && (
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-muted">
            Archived ({archived.length})
          </summary>
          <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
            {archived.map((row) => (
              <li
                key={row.id}
                className="min-w-0 px-5 py-4 font-semibold wrap-break-word"
              >
                {row.name}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function NamedRow({
  slug,
  noun,
  row,
  flagLabel,
  save,
  archive,
  last,
}: Omit<Props, "rows"> & { row: Row | null; last: boolean }) {
  const [name, setName] = useState(row?.name ?? "");
  const [flag, setFlag] = useState(row?.flag ?? false);
  const [saved, saveAction, saving] = useActionState(
    save.bind(null, slug, row?.id ?? null),
    null,
  );
  const [archived, archiveAction, archiving] = useActionState(
    archive.bind(null, slug, row?.id ?? ""),
    null,
  );
  const pending = saving || archiving;
  const failed = [saved, archived].find((state) => state && !state.ok);
  const id = `${noun.replaceAll(" ", "-")}-${row?.id ?? "new"}`;
  return (
    <div className={row ? "min-w-0" : "mt-3 min-w-0"}>
      <form
        action={saveAction}
        aria-busy={saving}
        aria-label={row ? row.name : `New ${noun}`}
        className="flex min-w-0 flex-wrap items-end gap-3"
      >
        <div className="min-w-0 flex-1 basis-56">
          <label
            htmlFor={`${id}-name`}
            className="mb-2 block text-sm font-semibold"
          >
            Name
          </label>
          <input
            id={`${id}-name`}
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
            disabled={pending}
            className={inputClass}
          />
        </div>
        {flagLabel && (
          <label className="flex min-h-12 items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              name="flag"
              checked={flag}
              onChange={(event) => setFlag(event.target.checked)}
              disabled={pending}
              className="size-5"
            />
            {flagLabel}
          </label>
        )}
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 rounded-xl bg-brand px-5 font-semibold text-surface disabled:opacity-50"
        >
          {saving ? "Saving…" : row ? "Save" : "Add"}
        </button>
        {row && (
          <button
            type="submit"
            formAction={archiveAction}
            disabled={pending || last}
            className="min-h-12 rounded-xl border border-line-strong px-4 text-sm font-semibold text-overdue disabled:opacity-50"
          >
            {archiving ? "Archiving…" : "Archive"}
          </button>
        )}
      </form>
      {row && last && (
        <p className="mt-2 text-sm text-muted">Keep at least one {noun}.</p>
      )}
      {saved?.ok && (
        <p role="status" className="mt-2 text-sm text-brand">
          Saved.
        </p>
      )}
      {failed && !failed.ok && (
        <p role="alert" className="mt-2 text-sm text-overdue">
          {failed.message}
        </p>
      )}
      {failed && !failed.ok && failed.error === "step_up_required" && (
        <FreshCodeForm enabled={!pending} />
      )}
    </div>
  );
}
