"use client";

import { tz } from "@date-fns/tz";
import { differenceInCalendarDays } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useId, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import { formatClock, formatDay } from "@/lib/dates";
import type { Stage } from "@/modules/settings/types";
import type { Bucket, LeadRow, Priority, TodayCounts } from "../types";
import { LeadRowCard } from "./LeadRowCard";
import { TodayFilters } from "./TodayFilters";

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
  selectedLeadId,
  leadPicked,
  detail,
}: {
  rows: LeadRow[];
  counts: TodayCounts | null;
  hasAssignedLeads: boolean;
  stages: Pick<Stage, "id" | "name" | "position">[];
  slug: string;
  now: Date;
  selectedLeadId: string | undefined;
  leadPicked: boolean;
  detail: ReactNode;
}) {
  const router = useRouter();
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
  const isEmpty = counts !== null && !hasAssignedLeads;
  let nextDue = "No calls scheduled next.";
  if (counts?.nextDueAt) {
    const tomorrow =
      differenceInCalendarDays(counts.nextDueAt, now, {
        in: tz("Asia/Kathmandu"),
      }) === 1;
    nextDue = tomorrow
      ? `Next one is due tomorrow at ${formatClock(counts.nextDueAt)}`
      : `Next one is due ${formatDay(counts.nextDueAt, now)}`;
  }
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[13rem_minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start lg:gap-5">
      <div
        className={`min-w-0 lg:sticky lg:top-6 ${leadPicked ? "max-lg:hidden" : ""}`}
      >
        <TodayFilters
          counts={counts}
          stages={stages}
          query={query}
          priority={priority}
          stage={stage}
          onQueryChange={setQuery}
          onPriorityChange={setPriority}
          onStageChange={setStage}
        />
      </div>
      <section
        className={`min-w-0 space-y-5 ${leadPicked ? "max-lg:hidden" : ""}`}
        aria-label="Today's leads"
      >
        {!counts && (
          <LoadError
            message="Couldn't load this page"
            onRetry={() => router.refresh()}
          />
        )}
        {isEmpty && <EmptyState title="No leads assigned to you yet" />}
        {counts && !isEmpty && hasFilters && filtered.length === 0 && (
          <EmptyState
            title={
              priority === "all"
                ? "No leads match"
                : `No ${priority} leads match`
            }
            description="Try another search or filter."
          />
        )}
        {counts && !hasFilters && counts.overdue === 0 && !isEmpty && (
          <div className="rounded-2xl border border-call/20 bg-call-soft p-5">
            <h2 className="font-display text-xl font-semibold text-call">
              Good day. Nothing overdue.
            </h2>
            <p className="mt-2 text-sm text-call">{nextDue}</p>
          </div>
        )}
        <div className="min-w-0 space-y-6">
          {sections.map(({ bucket, title, style }) => {
            const items = filtered.filter((row) => row.bucket === bucket);
            if (hasFilters && items.length === 0) return null;
            if (!counts || isEmpty) return null;
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
                    selected={lead.id === selectedLeadId}
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
      <div
        className={`min-w-0 space-y-4 lg:[&>section>header]:grid-cols-1 lg:[&>section>div]:grid-cols-1 ${leadPicked ? "" : "max-lg:hidden"}`}
      >
        {leadPicked && (
          <Link
            href={`/${slug}/today`}
            className="inline-flex min-h-11 items-center font-semibold text-brand underline-offset-4 hover:underline lg:hidden"
          >
            Back to the list
          </Link>
        )}
        {detail}
      </div>
    </div>
  );
}
