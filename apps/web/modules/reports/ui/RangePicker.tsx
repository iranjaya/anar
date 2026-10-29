"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useState, useTransition } from "react";

export function RangePicker({
  value,
  from,
  to,
}: {
  value: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const id = useId();
  const [range, setRange] = useState(value);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function apply(next: string) {
    const params = new URLSearchParams(search.toString());
    params.set("range", next);
    params.delete("from");
    params.delete("to");
    if (next === "custom") {
      params.set("from", start);
      params.set("to", end);
    }
    startTransition(() =>
      router.push(`${pathname}?${params}`, { scroll: false }),
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (end < start) {
          setError("To must be on or after From.");
          return;
        }
        setError("");
        apply("custom");
      }}
      className="space-y-3"
    >
      <label className="block text-sm font-semibold">
        Report range
        <select
          value={range}
          disabled={pending}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setRange(next);
            setError("");
            if (next !== "custom") apply(next);
          }}
          className="ml-2 min-h-11 max-w-full rounded-xl border border-line-strong bg-surface px-3 text-base"
        >
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {range === "custom" && (
        <div className="flex flex-wrap items-start gap-3">
          <label className="min-w-0 text-sm font-semibold">
            From
            <input
              type="date"
              required
              value={start}
              onChange={(event) => setStart(event.currentTarget.value)}
              className="block min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-3 text-base"
            />
          </label>
          <label className="min-w-0 text-sm font-semibold">
            To
            <input
              type="date"
              required
              value={end}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => {
                setEnd(event.currentTarget.value);
                setError("");
              }}
              className="block min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-3 text-base"
            />
            {error && (
              <span
                id={`${id}-error`}
                role="alert"
                className="mt-1 block text-sm text-overdue"
              >
                {error}
              </span>
            )}
          </label>
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 self-end rounded-xl border border-line-strong bg-surface px-4 font-semibold disabled:opacity-50"
          >
            Apply range
          </button>
        </div>
      )}
    </form>
  );
}
