"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { EmptyState } from "@/components/EmptyState";
import type { Metrics } from "../types";

export function Compare({
  members,
  a,
  b,
  metrics,
  rangeLabel,
}: {
  members: { memberId: string; name: string }[];
  a: string;
  b: string;
  metrics: { a: Metrics; b: Metrics } | null;
  rangeLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  function pick(first: string, second: string) {
    const params = new URLSearchParams(search.toString());
    params.set("a", first);
    params.set("b", second);
    startTransition(() =>
      router.push(`${pathname}?${params}`, { scroll: false }),
    );
  }
  const labels: { key: keyof Metrics; label: string }[] = [
    { key: "calls", label: "Calls" },
    { key: "medianResponseHours", label: "Median response · hours" },
    { key: "siteVisits", label: "Site visits" },
    { key: "bookings", label: "Bookings" },
    { key: "conversion", label: "Bookings / leads held · %" },
  ];
  return (
    <section
      aria-label="Compare people"
      className="min-w-0 space-y-4 rounded-2xl border border-line bg-surface p-4"
    >
      <h2 className="font-display text-xl font-bold">Compare · {rangeLabel}</h2>
      {members.length < 2 ? (
        <EmptyState title="Two salespeople needed to compare" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="min-w-0 text-sm font-semibold text-compare-a">
              First person
              <select
                aria-label="First person"
                value={a}
                disabled={pending}
                onChange={(event) => {
                  const first = event.currentTarget.value;
                  const second =
                    first === b
                      ? (members.find((member) => member.memberId !== first)
                          ?.memberId ?? "")
                      : b;
                  pick(first, second);
                }}
                className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-2 text-base text-ink"
              >
                {members.map((member) => (
                  <option key={member.memberId} value={member.memberId}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-sm font-semibold text-compare-b">
              Second person
              <select
                aria-label="Second person"
                value={b}
                disabled={pending}
                onChange={(event) => pick(a, event.currentTarget.value)}
                className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-2 text-base text-ink"
              >
                {members
                  .filter((member) => member.memberId !== a)
                  .map((member) => (
                    <option key={member.memberId} value={member.memberId}>
                      {member.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {metrics && (
            <dl className="space-y-3">
              {labels.map(({ key, label }) => (
                <div key={key}>
                  <dt className="text-sm text-muted">{label}</dt>
                  <dd className="grid grid-cols-2 gap-3 font-display text-xl font-semibold">
                    {(["a", "b"] as const).map((side) => (
                      <span
                        key={side}
                        className={
                          side === "a" ? "text-compare-a" : "text-compare-b"
                        }
                      >
                        {metrics[side][key] === null
                          ? "No response yet"
                          : Number(metrics[side][key].toFixed(1))}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </section>
  );
}
