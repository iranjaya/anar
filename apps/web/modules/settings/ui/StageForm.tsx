"use client";

import type { Stage } from "@anar/domain/settings";
import { useActionState, useEffect, useState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import { upsertStageAction } from "../actions";
import { inputClass } from "./DefinitionInputs";

const empty = { id: "", name: "", kind: "open", isDefault: false };

export function StageForm({ slug, stages }: { slug: string; stages: Stage[] }) {
  const [stage, setStage] = useState(empty);
  const [state, action, pending] = useActionState(
    upsertStageAction.bind(null, slug),
    null,
  );
  useEffect(() => {
    if (state?.ok) setStage(empty);
  }, [state]);
  const choose = (id: string) => {
    const found = stages.find((row) => row.id === id);
    setStage(found ? { ...found } : empty);
  };
  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-5 lg:p-6">
      <h3 className="font-display text-lg font-semibold">
        Add or rename a stage
      </h3>
      <p className="mt-1 text-sm text-muted">
        Leads keep their stage when you rename it. Won and lost stages end a
        lead. A fresh code is required to save.
      </p>
      <form action={action} aria-busy={pending} className="mt-4 space-y-4">
        <div>
          <label
            htmlFor="stage-id"
            className="mb-2 block text-sm font-semibold"
          >
            Stage
          </label>
          <select
            id="stage-id"
            name="id"
            value={stage.id}
            onChange={(event) => choose(event.target.value)}
            disabled={pending}
            className={inputClass}
          >
            <option value="">New stage</option>
            {stages.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <label
              htmlFor="stage-name"
              className="mb-2 block text-sm font-semibold"
            >
              Name
            </label>
            <input
              id="stage-name"
              name="name"
              value={stage.name}
              onChange={(event) =>
                setStage({ ...stage, name: event.target.value })
              }
              maxLength={120}
              required
              disabled={pending}
              className={inputClass}
            />
          </div>
          <div className="min-w-0">
            <label
              htmlFor="stage-kind"
              className="mb-2 block text-sm font-semibold"
            >
              Type
            </label>
            <select
              id="stage-kind"
              name="kind"
              value={stage.kind}
              onChange={(event) =>
                setStage({ ...stage, kind: event.target.value })
              }
              disabled={pending}
              className={inputClass}
            >
              <option value="open">Open</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </div>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            name="isDefault"
            checked={stage.isDefault}
            onChange={(event) =>
              setStage({ ...stage, isDefault: event.target.checked })
            }
            disabled={pending || stage.kind !== "open"}
            className="size-5"
          />
          New leads start here
        </label>
        <p className="text-sm text-muted">
          Only an open stage can be the default. To move the default, tick it on
          another stage.
        </p>
        {state && !state.ok && (
          <p role="alert" className="text-sm text-overdue">
            {state.message}
          </p>
        )}
        {state?.ok && (
          <p role="status" className="text-sm text-brand">
            Stage saved.
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 w-full rounded-xl bg-brand px-5 font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
        >
          {pending ? "Saving…" : "Save stage"}
        </button>
      </form>
      {state && !state.ok && state.error === "step_up_required" && (
        <FreshCodeForm enabled={!pending} />
      )}
    </section>
  );
}
