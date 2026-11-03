"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { LostReason } from "@/modules/settings/types";
import { changeStageAction, dismissLostSuggestionAction } from "../actions";
import { changeStageAction as changeStageRealAction } from "../editActions";
import { ReasonChips } from "./ReasonChips";

export function LostSuggestion({
  leadId,
  failedAttempts,
  lostStageId,
  reasons,
  suggestionEventId,
  real = false,
}: {
  leadId: string;
  failedAttempts: number;
  lostStageId: string | null;
  reasons: LostReason[];
  suggestionEventId?: string;
  real?: boolean;
}) {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function save(kind: "lost" | "keep") {
    setError("");
    startTransition(async () => {
      try {
        let result: { ok: true } | { ok: false; message: string };
        if (kind === "lost") {
          if (!lostStageId) throw new Error("No active Lost stage");
          result = real
            ? await changeStageRealAction(slug, {
                leadId,
                stageId: lostStageId,
                lostReasonId: reason,
                suggestionEventId,
              })
            : await changeStageAction({
                slug,
                leadId,
                stageId: lostStageId,
                lostReasonId: reason,
              });
        } else {
          result = await dismissLostSuggestionAction({
            slug,
            leadId,
            suggestionEventId,
          });
        }
        if (!result.ok) {
          setError(result.message);
          return;
        }
        router.refresh();
      } catch {
        setError("Couldn't save this change. Try again.");
      }
    });
  }
  return (
    <section
      aria-label="Lost suggestion"
      className="space-y-4 rounded-2xl border border-due-edge bg-due-soft p-5"
    >
      <div>
        <h2 className="font-display text-xl font-semibold text-due">
          Keep trying or mark as Lost?
        </h2>
        <p className="mt-2 text-sm text-due">
          {failedAttempts} failed attempts
        </p>
      </div>
      {picking && (
        <ReasonChips
          reasons={reasons}
          value={reason}
          onPick={setReason}
          disabled={pending}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-overdue">
          {error}
        </p>
      )}
      {picking && !reason && (
        <p className="text-sm text-muted">Pick why it was lost</p>
      )}
      <div className="flex flex-wrap gap-3">
        {lostStageId && (
          <button
            type="button"
            disabled={pending || (picking && !reason)}
            onClick={() => (picking ? save("lost") : setPicking(true))}
            className="min-h-14 rounded-xl bg-overdue px-4 font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-overdue disabled:opacity-50"
          >
            Mark as Lost
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => save("keep")}
          className="min-h-14 rounded-xl border border-due bg-surface px-4 font-semibold text-due focus-visible:outline-2 focus-visible:outline-due disabled:opacity-50"
        >
          Keep trying
        </button>
      </div>
    </section>
  );
}
