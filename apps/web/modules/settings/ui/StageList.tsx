"use client";

import type { SettingsCatalog } from "@anar/domain/settings";
import { useActionState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import { archiveStageAction, reorderStagesAction } from "../actions";

type StageRow = SettingsCatalog["stages"][number];

export function StageList({
  slug,
  stages,
}: {
  slug: string;
  stages: StageRow[];
}) {
  const active = stages.filter((stage) => stage.archivedAt === null);
  const archived = stages.filter((stage) => stage.archivedAt !== null);
  const ids = active.map((stage) => stage.id);
  const moved = (index: number, to: number) => {
    const order = [...ids];
    [order[index], order[to]] = [order[to], order[index]];
    return order;
  };
  return (
    <>
      <ol className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
        {active.map((stage, index) => (
          <StageItem
            key={stage.id}
            slug={slug}
            stage={stage}
            up={index > 0 ? moved(index, index - 1) : null}
            down={index < active.length - 1 ? moved(index, index + 1) : null}
            locked={lockReason(stage, active)}
          />
        ))}
      </ol>
      {archived.length > 0 && (
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-muted">
            Archived ({archived.length})
          </summary>
          <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
            {archived.map((stage) => (
              <li key={stage.id} className="min-w-0 px-5 py-4">
                <p className="font-semibold wrap-break-word">{stage.name}</p>
                <p className="text-sm text-muted capitalize">{stage.kind}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function lockReason(stage: StageRow, active: StageRow[]): string | null {
  if (stage.isDefault) return "The default stage cannot be archived.";
  const sameKind = active.filter((row) => row.kind === stage.kind);
  if (stage.kind !== "open" && sameKind.length === 1)
    return `The last ${stage.kind} stage cannot be archived.`;
  return null;
}

function StageItem({
  slug,
  stage,
  up,
  down,
  locked,
}: {
  slug: string;
  stage: StageRow;
  up: string[] | null;
  down: string[] | null;
  locked: string | null;
}) {
  const [movedUp, moveUp, movingUp] = useActionState(
    reorderStagesAction.bind(null, slug, up ?? []),
    null,
  );
  const [movedDown, moveDown, movingDown] = useActionState(
    reorderStagesAction.bind(null, slug, down ?? []),
    null,
  );
  const [archived, archive, archiving] = useActionState(
    archiveStageAction.bind(null, slug, stage.id),
    null,
  );
  const pending = movingUp || movingDown || archiving;
  const failed = [movedUp, movedDown, archived].find(
    (state) => state && !state.ok,
  );
  const button =
    "min-h-11 rounded-xl border border-line-strong px-3 text-sm font-semibold disabled:opacity-50";
  return (
    <li className="min-w-0 px-5 py-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold wrap-break-word">{stage.name}</p>
          <p className="text-sm text-muted capitalize">
            {stage.isDefault ? `${stage.kind} · default` : stage.kind}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={moveUp}>
            <button
              type="submit"
              aria-label={`Move ${stage.name} up`}
              disabled={pending || !up}
              className={button}
            >
              Up
            </button>
          </form>
          <form action={moveDown}>
            <button
              type="submit"
              aria-label={`Move ${stage.name} down`}
              disabled={pending || !down}
              className={button}
            >
              Down
            </button>
          </form>
          <form action={archive}>
            <button
              type="submit"
              aria-label={`Archive ${stage.name}`}
              disabled={pending || locked !== null}
              className={`${button} text-overdue`}
            >
              Archive
            </button>
          </form>
        </div>
      </div>
      {locked && <p className="mt-2 text-sm text-muted">{locked}</p>}
      {failed && !failed.ok && (
        <p role="alert" className="mt-2 text-sm text-overdue">
          {failed.message}
        </p>
      )}
      {failed && !failed.ok && failed.error === "step_up_required" && (
        <FreshCodeForm enabled={!pending} />
      )}
    </li>
  );
}
