import { EmptyState } from "@/components/EmptyState";
import type { TeamOverview } from "../types";

export function Funnel({ funnel }: { funnel: TeamOverview["funnel"] }) {
  const total = funnel.reduce((sum, stage) => sum + stage.count, 0);
  return (
    <section
      aria-label="Lead funnel"
      className="min-w-0 rounded-2xl border border-line bg-surface p-4"
    >
      <h2 className="font-display text-xl font-bold">Funnel · now</h2>
      <p className="mb-4 text-sm text-muted">{total} leads across all stages</p>
      {total === 0 ? (
        <EmptyState title="No leads yet" />
      ) : (
        <ul className="space-y-3">
          {funnel.map((stage) => (
            <li key={stage.stageId}>
              <div className="mb-1 flex justify-between gap-2 text-sm">
                <span>{stage.name}</span>
                <span>{stage.count}</span>
              </div>
              <div className="h-2 rounded-full bg-brand-soft">
                <div
                  className="h-2 rounded-full bg-brand"
                  style={{ width: `${(stage.count / total) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
