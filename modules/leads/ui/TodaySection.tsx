"use client";

import { tz } from "@date-fns/tz";
import { differenceInCalendarDays } from "date-fns";
import { useId, useState } from "react";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { formatClock, formatDay } from "@/lib/dates";
import type { Stage } from "@/modules/settings/types";
import type { Bucket, LeadRow, Priority, TodayCounts } from "../types";
import { LeadRowCard } from "./LeadRowCard";

const sections: { bucket: Bucket; title: string; style: string }[] = [
  { bucket: "overdue", title: "Overdue", style: "text-overdue" },
  { bucket: "due_today", title: "Due today", style: "text-due" },
  { bucket: "new", title: "New", style: "text-new" },
];

export function TodaySection({
  rows,
  counts,
  hasAssignedLeads,
  stages,
  slug,
  now,
}: {
  rows: LeadRow[];
  counts: TodayCounts;
  hasAssignedLeads: boolean;
  stages: Pick<Stage, "id" | "name" | "position">[];
  slug: string;
  now: Date;
}) {
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [stage, setStage] = useState("");
  const id = useId();
  const search = query.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      (priority === "all" || row.priority === priority) &&
      (!stage || row.stage.id === stage) &&
      (!search ||
        row.fullName?.toLowerCase().includes(search) ||
        row.phoneE164?.includes(search)),
  );
  const hasFilters = Boolean(search || stage || priority !== "all");
  const isEmpty = !hasAssignedLeads;
  let nextDue = "No calls scheduled next.";
  if (counts.nextDueAt) {
    const tomorrow =
      differenceInCalendarDays(counts.nextDueAt, now, {
        in: tz("Asia/Kathmandu"),
      }) === 1;
    nextDue = tomorrow
      ? `Next one is due tomorrow at ${formatClock(counts.nextDueAt)}`
      : `Next one is due ${formatDay(counts.nextDueAt, now)}`;
  }
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-7">
      <aside
        aria-label="Today filters"
        className="min-w-0 space-y-5 lg:sticky lg:top-6"
      >
        <div className="rounded-2xl border border-brand/15 bg-surface p-5">
          <p className="font-display text-xl font-semibold tracking-tight">
            {counts.callsToday}
            {counts.callsTarget !== null && ` of ${counts.callsTarget}`} calls
            today
          </p>
          {counts.callsTarget !== null && counts.callsTarget > 0 && (
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
              onChange={(event) => setQuery(event.currentTarget.value)}
              className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-brand"
            />
          </label>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Score filter</legend>
            {(["all", "hot", "warm", "cold"] as const).map((value) => (
              <Chip
                key={value}
                selected={priority === value}
                onClick={() => setPriority(value)}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </Chip>
            ))}
          </fieldset>
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
            Stage
            <select
              value={stage}
              onChange={(event) => setStage(event.currentTarget.value)}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 text-base"
            >
              <option value="">All stages</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </aside>
      <section className="min-w-0 space-y-5" aria-label="Today's leads">
        {isEmpty && <EmptyState title="No leads assigned to you yet" />}
        {!isEmpty && hasFilters && filtered.length === 0 && (
          <EmptyState
            title={
              priority === "all"
                ? "No leads match"
                : `No ${priority} leads match`
            }
            description="Try another search or filter."
          />
        )}
        {!hasFilters && counts.overdue === 0 && !isEmpty && (
          <div className="rounded-2xl border border-call/20 bg-call-soft p-5">
            <h2 className="font-display text-xl font-semibold text-call">
              Good day. Nothing overdue.
            </h2>
            <p className="mt-2 text-sm text-call">{nextDue}</p>
          </div>
        )}
        <div className="grid min-w-0 gap-6 lg:grid-cols-3 lg:items-start lg:gap-4">
          {sections.map(({ bucket, title, style }) => {
            const items = filtered.filter((row) => row.bucket === bucket);
            if (hasFilters && items.length === 0) return null;
            if (isEmpty) return null;
            return (
              <section
                key={bucket}
                aria-labelledby={`${id}-${bucket}`}
                className="min-w-0 space-y-3"
              >
                <h2
                  id={`${id}-${bucket}`}
                  className={`flex min-h-11 items-center justify-between gap-2 border-b border-line pb-3 font-display text-lg font-semibold ${style}`}
                >
                  {title}{" "}
                  <span className="flex size-7 items-center justify-center rounded-full border border-line bg-surface text-sm tabular-nums">
                    {items.length}
                  </span>
                </h2>
                {items.map((lead) => (
                  <LeadRowCard
                    key={lead.id}
                    lead={lead}
                    slug={slug}
                    now={now}
                  />
                ))}
                {items.length === 0 && (
                  <p className="text-sm text-muted">
                    No {title.toLowerCase()} leads.
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}
