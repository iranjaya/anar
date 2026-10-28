import type { Field } from "@/modules/settings/types";

export function WhyScore({
  breakdown,
  fields,
  hotMin,
}: {
  breakdown: Record<string, number>;
  fields: Pick<Field, "key" | "label">[];
  hotMin: number;
}) {
  const total = Object.values(breakdown).reduce(
    (sum, points) => sum + points,
    0,
  );
  return (
    <details className="rounded-2xl border border-line bg-surface px-4">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-brand">
        {total >= hotMin ? "Why Hot" : "Why this score"}
      </summary>
      <dl className="space-y-2 border-t border-line py-3 text-sm">
        {Object.entries(breakdown).map(([key, points]) => (
          <div key={key} className="flex justify-between gap-4">
            <dt className="text-muted">
              {key === "base"
                ? "Base score"
                : (fields.find((field) => field.key === key)?.label ?? key)}
            </dt>
            <dd className="font-semibold tabular-nums">
              {points} {points === 1 ? "pt" : "pts"}
            </dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line py-3 text-sm text-muted">
        Hot starts at {hotMin}
      </p>
    </details>
  );
}
