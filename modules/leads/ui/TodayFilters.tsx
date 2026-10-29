import { Chip } from "@/components/Chip";
import type { Stage } from "@/modules/settings/types";
import type { Priority, TodayCounts } from "../types";

export function TodayFilters({
  counts,
  stages,
  query,
  priority,
  stage,
  onQueryChange,
  onPriorityChange,
  onStageChange,
}: {
  counts: TodayCounts | null;
  stages: Pick<Stage, "id" | "name" | "position">[];
  query: string;
  priority: Priority | "all";
  stage: string;
  onQueryChange: (query: string) => void;
  onPriorityChange: (priority: Priority | "all") => void;
  onStageChange: (stage: string) => void;
}) {
  return (
    <aside aria-label="Today filters" className="min-w-0 space-y-5">
      <div className="rounded-2xl border border-brand/15 bg-surface p-5">
        <p className="font-display text-xl font-semibold tracking-tight">
          {counts ? (
            <>
              {counts.callsToday}
              {counts.callsTarget !== null && ` of ${counts.callsTarget}`} calls
              today
            </>
          ) : (
            "Calls today unavailable"
          )}
        </p>
        {counts && counts.callsTarget !== null && counts.callsTarget > 0 && (
          <progress
            aria-label="Calls today against target"
            value={Math.min(counts.callsToday, counts.callsTarget)}
            max={counts.callsTarget}
            className="mt-3 h-2 w-full appearance-none overflow-hidden rounded-full bg-line [&::-webkit-progress-bar]:bg-line [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-brand [&::-moz-progress-bar]:bg-brand"
          />
        )}
      </div>
      <div className="space-y-3">
        <label className="block text-sm font-semibold">
          Search leads
          <input
            type="search"
            placeholder="Name or phone"
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-brand"
          />
        </label>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Score filter</legend>
          {(["all", "hot", "warm", "cold"] as const).map((value) => (
            <Chip
              key={value}
              selected={priority === value}
              onClick={() => onPriorityChange(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </Chip>
          ))}
        </fieldset>
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
          Stage
          <select
            value={stage}
            disabled={counts === null}
            onChange={(event) => onStageChange(event.currentTarget.value)}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 text-base"
          >
            <option value="">
              {counts ? "All stages" : "Stages unavailable"}
            </option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </aside>
  );
}
