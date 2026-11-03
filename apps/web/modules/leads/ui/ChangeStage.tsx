"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Chip } from "@/components/Chip";
import type { LostReason, Stage } from "@/modules/settings/types";
import { changeStageAction } from "../editActions";
import type { Lead } from "../types";
import { ReasonChips } from "./ReasonChips";

export function ChangeStage({
  slug,
  lead,
  stages,
  reasons,
}: {
  slug: string;
  lead: Pick<Lead, "id" | "stageId" | "lostReasonId">;
  stages: Pick<Stage, "id" | "name" | "kind">[];
  reasons: Pick<LostReason, "id" | "name">[];
}) {
  const router = useRouter();
  const id = useId();
  const [stageId, setStageId] = useState(lead.stageId);
  const [reasonId, setReasonId] = useState(lead.lostReasonId ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const lost = stages.find((stage) => stage.id === stageId)?.kind === "lost";
  const unchanged =
    stageId === lead.stageId &&
    (lost ? reasonId : "") === (lead.lostReasonId ?? "");

  function save() {
    setError("");
    startTransition(async () => {
      const result = await changeStageAction(slug, {
        leadId: lead.id,
        stageId,
        lostReasonId: lost ? reasonId || null : null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section
      aria-label="Change stage"
      className="space-y-4 rounded-2xl border border-line bg-surface p-5"
    >
      <fieldset disabled={pending} className="min-w-0">
        <legend className="mb-3 font-display text-xl font-semibold">
          Stage
        </legend>
        <div className="flex flex-wrap gap-2">
          {stages.map((stage) => (
            <Chip
              key={stage.id}
              selected={stage.id === stageId}
              onClick={() => setStageId(stage.id)}
            >
              {stage.name}
            </Chip>
          ))}
        </div>
      </fieldset>
      {lost && (
        <ReasonChips
          reasons={reasons}
          value={reasonId}
          onPick={setReasonId}
          disabled={pending}
        />
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-overdue">
          {error}
        </p>
      )}
      {lost && !reasonId && (
        <p id={`${id}-reason`} className="text-sm text-muted">
          Pick why the lead was lost
        </p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={pending || unchanged || (lost && !reasonId)}
        aria-describedby={lost && !reasonId ? `${id}-reason` : undefined}
        className="min-h-12 w-full rounded-xl bg-brand px-4 font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save stage"}
      </button>
    </section>
  );
}
