"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useId, useState, useTransition } from "react";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import type { Stage } from "@/modules/settings/types";
import { nextDueText } from "../buckets";
import { listTodayBucketAction } from "../todayActions";
import type { Bucket, LeadRow, Priority, TodayCounts } from "../types";
import { LeadRowCard } from "./LeadRowCard";
import { TodayFilters } from "./TodayFilters";

const sections: { bucket: Bucket; title: string; style: string }[] = [
  { bucket: "overdue", title: "Overdue", style: "text-overdue" },
  { bucket: "due_today", title: "Due today", style: "text-due" },
  { bucket: "new", title: "New", style: "text-new" },
];

export function TodaySection({
  rows: firstRows,
  counts,
  hasAssignedLeads,
  stages,
  slug,
  now,
  timezone,
  selectedLeadId,
  leadPicked,
  detail,
  cursors: firstCursors,
}: {
  rows: LeadRow[];
  counts: TodayCounts | null;
  hasAssignedLeads: boolean;
  stages: Pick<Stage, "id" | "name" | "position">[];
  slug: string;
  now: Date;
  timezone: string;
  selectedLeadId: string | undefined;
  leadPicked: boolean;
  detail: ReactNode;
  cursors?: Partial<Record<Bucket, string | null>>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(firstRows);
  const [cursors, setCursors] = useState(firstCursors ?? {});
  const [previousRows, setPreviousRows] = useState(firstRows);
  if (firstRows !== previousRows) {
    setPreviousRows(firstRows);
    setRows(firstRows);
    setCursors(firstCursors ?? {});
  }
  const [loading, startLoading] = useTransition();
  const [moreError, setMoreError] = useState("");
  function showMore(bucket: Bucket) {
    const cursor = cursors[bucket];
    if (!cursor) return;
    setMoreError("");
    startLoading(async () => {
      const result = await listTodayBucketAction({ slug, bucket, cursor });
      if (!result.ok) {
        setMoreError(result.message);
        return;
      }
      setRows((current) => [...current, ...result.data.items]);
      setCursors((current) => ({
        ...current,
        [bucket]: result.data.nextCursor,
      }));
    });
  }
  const totals: Record<Bucket, number | undefined> = {
    overdue: counts?.overdue,
    due_today: counts?.dueToday,
    new: counts?.newLeads,
  };
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
  const hasMore = sections.some(({ bucket }) => Boolean(cursors[bucket]));
  const isEmpty = counts !== null && !hasAssignedLeads;
  const nextDue = nextDueText(counts?.nextDueAt ?? null, now, timezone);
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
        {moreError && (
          <p role="alert" className="text-sm text-overdue">
            {moreError}
          </p>
        )}
        {counts &&
          !isEmpty &&
          hasFilters &&
          filtered.length === 0 &&
          !hasMore && (
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
            if (hasFilters && items.length === 0 && !cursors[bucket])
              return null;
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
                  <span className="flex min-w-7 items-center justify-center rounded-full border border-line bg-surface px-1.5 text-sm tabular-nums">
                    {hasFilters
                      ? items.length
                      : (totals[bucket] ?? items.length)}
                  </span>
                </h2>
                {items.map((lead) => (
                  <LeadRowCard
                    key={lead.id}
                    lead={lead}
                    slug={slug}
                    now={now}
                    timezone={timezone}
                    selected={lead.id === selectedLeadId}
                  />
                ))}
                {items.length === 0 && !cursors[bucket] && (
                  <p className="text-sm text-muted">
                    No {title.toLowerCase()} leads.
                  </p>
                )}
                {cursors[bucket] && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => showMore(bucket)}
                    className="min-h-11 text-sm font-semibold text-brand underline disabled:opacity-50"
                  >
                    {loading ? "Loading…" : `Show more ${title.toLowerCase()}`}
                  </button>
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
