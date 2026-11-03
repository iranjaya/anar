"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { formatDay } from "@/lib/dates";
import type { ActionResult } from "@/lib/errors";
import { formatPhone } from "@/lib/phone";
import { ScoreBadge } from "@/modules/scoring/components";
import type { Member } from "@/modules/tenant/types";
import { assignLeadsAction } from "../actions";
import type { LeadRow, Priority } from "../types";

const unassign = "unassign";

const columns =
  "lg:grid-cols-[2.75rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)]";

export function AssignList({
  items,
  members,
  timezone,
  onAssigned,
  total = items.length,
  nextCursor = null,
  q = "",
  priority,
  compact = false,
  noun = "unassigned leads",
  assignNote,
  assignAction,
}: {
  items: LeadRow[];
  members: Pick<Member, "id" | "name">[];
  timezone: string;
  onAssigned?: () => void;
  total?: number;
  nextCursor?: string | null;
  q?: string;
  priority?: Priority;
  compact?: boolean;
  noun?: string;
  assignNote?: string;
  assignAction?: (input: {
    slug: string;
    leadIds: string[];
    memberId: string | null;
  }) => Promise<ActionResult<{ updated: number }>>;
}) {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const id = useId();
  const [query, setQuery] = useState(q);
  const [picked, setPicked] = useState<string[]>([]);
  const [memberId, setMemberId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => setQuery(q), [q]);
  const allPicked =
    items.length > 0 && items.every((lead) => picked.includes(lead.id));
  const detailCell = compact
    ? "hidden"
    : "col-start-2 min-w-0 break-words text-muted lg:col-start-auto";
  let emptyTitle = "No leads match";
  if (priority) emptyTitle = `No ${priority} leads waiting`;
  if (total === 0) emptyTitle = `No ${noun}`;

  function href(search: string, score?: Priority, cursor?: string) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (score) params.set("priority", score);
    if (cursor) params.set("cursor", cursor);
    return `/${slug}/leads?${params}`;
  }

  function buttonLabel() {
    if (memberId === unassign)
      return pending ? "Unassigning…" : `Unassign ${picked.length} leads`;
    return pending ? "Assigning…" : `Assign ${picked.length} leads`;
  }

  function assign() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const result = assignAction
          ? await assignAction({
              slug,
              leadIds: picked,
              memberId: memberId === unassign ? null : memberId,
            })
          : await assignLeadsAction({ slug, leadIds: picked, memberId });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setMessage(
          memberId === unassign
            ? `${result.data.updated} leads unassigned.`
            : `${result.data.updated} leads assigned to ${members.find((member) => member.id === memberId)?.name}.`,
        );
        setPicked([]);
        onAssigned?.();
        if (!compact) router.replace(href(q, priority), { scroll: false });
        router.refresh();
      } catch {
        setError("Couldn't assign these leads. Try again.");
      }
    });
  }

  return (
    <div className={compact ? "min-w-0" : "min-w-0 pb-64 lg:pb-0"}>
      <p className="mb-6 text-muted">
        {total} {noun}
      </p>
      <div
        className={
          compact
            ? "grid min-w-0 items-start gap-4"
            : "grid min-w-0 items-start gap-5 lg:grid-cols-[11rem_minmax(0,1fr)_13rem]"
        }
      >
        <aside
          aria-label="Queue filters"
          className={
            compact ? "hidden" : "min-w-0 space-y-4 lg:sticky lg:top-6"
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              router.push(href(query, priority), { scroll: false });
            }}
            className="space-y-2"
          >
            <label htmlFor={`${id}-search`} className="text-sm font-semibold">
              Search leads
            </label>
            <input
              id={`${id}-search`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Name or phone"
              className="min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-3 text-base"
            />
            <button
              type="submit"
              className="min-h-11 rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold"
            >
              Search
            </button>
          </form>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-2 text-sm font-semibold">Score filter</legend>
            {(["all", "hot", "warm", "cold"] as const).map((score) => (
              <Chip
                key={score}
                selected={(priority ?? "all") === score}
                onClick={() =>
                  router.push(
                    href(query, score === "all" ? undefined : score),
                    { scroll: false },
                  )
                }
              >
                {score[0].toUpperCase() + score.slice(1)}
              </Chip>
            ))}
          </fieldset>
        </aside>
        <section
          aria-label="Unassigned queue"
          className={
            compact
              ? "min-w-0 space-y-3 lg:max-h-[32rem] lg:overflow-y-auto"
              : "min-w-0 space-y-3"
          }
        >
          <table
            aria-label="Unassigned leads"
            className="block w-full min-w-0 space-y-3 text-left"
          >
            <thead className="block">
              <tr
                className={`grid items-center gap-2 px-3 text-sm font-semibold text-muted ${compact ? "grid-cols-1" : columns}`}
              >
                <th scope="col">
                  <label className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={allPicked}
                      disabled={pending || items.length === 0}
                      onChange={() =>
                        setPicked(
                          allPicked
                            ? picked.filter(
                                (leadId) =>
                                  !items.some((lead) => lead.id === leadId),
                              )
                            : [
                                ...picked,
                                ...items
                                  .filter((lead) => !picked.includes(lead.id))
                                  .map((lead) => lead.id),
                              ],
                        )
                      }
                      className="size-5 shrink-0 accent-brand"
                    />
                    <span className={compact ? "" : "lg:sr-only"}>
                      Select all {items.length} shown
                    </span>
                  </label>
                </th>
                {[
                  "Name",
                  "Score",
                  "Apartment",
                  "Buying when",
                  "Platform",
                  "Time",
                ].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className={
                      compact ? "hidden" : "hidden min-w-0 break-words lg:block"
                    }
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="block space-y-3">
              {items.map((lead) => (
                <tr
                  key={lead.id}
                  className={`grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-line bg-surface p-3 text-sm ${compact ? "" : columns}`}
                >
                  <td>
                    <label className="flex min-h-11 items-center justify-center">
                      <input
                        type="checkbox"
                        aria-label={`Select ${lead.fullName ?? formatPhone(lead.phoneE164)}`}
                        checked={picked.includes(lead.id)}
                        disabled={pending}
                        onChange={(event) =>
                          setPicked(
                            event.currentTarget.checked
                              ? [...picked, lead.id]
                              : picked.filter((leadId) => leadId !== lead.id),
                          )
                        }
                        className="size-5 accent-brand"
                      />
                    </label>
                  </td>
                  <td className="min-w-0">
                    <Link
                      href={`/${slug}/leads/${lead.id}`}
                      className="flex min-h-11 items-center break-words font-semibold text-ink underline-offset-4 hover:text-brand hover:underline"
                    >
                      {lead.fullName ?? formatPhone(lead.phoneE164)}
                    </Link>
                  </td>
                  <td
                    className={
                      compact
                        ? "col-start-2 min-w-0"
                        : "col-start-2 min-w-0 lg:col-start-auto"
                    }
                  >
                    <ScoreBadge priority={lead.priority} score={lead.score} />
                  </td>
                  <td className={detailCell}>
                    {
                      lead.answers.find(
                        (answer) => answer.key === "apartment_type",
                      )?.label
                    }
                  </td>
                  <td className={detailCell}>
                    {
                      lead.answers.find(
                        (answer) => answer.key === "purchase_timeline",
                      )?.label
                    }
                  </td>
                  <td className={`${detailCell} capitalize`}>{lead.source}</td>
                  <td className={detailCell}>
                    {formatDay(lead.leadDate, timezone)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && (
            <EmptyState
              title={emptyTitle}
              description={
                total > 0 ? "Try another search or filter." : undefined
              }
            />
          )}
          {nextCursor && (
            <Link
              href={href(q, priority, nextCursor)}
              className="inline-flex min-h-11 items-center font-semibold text-brand underline"
            >
              Next 50 leads
            </Link>
          )}
          <p role="status" className="text-sm text-call">
            {message}
          </p>
        </section>
        <section
          aria-label="Assign leads"
          className={
            compact
              ? "space-y-3 border-t border-line pt-4"
              : "fixed inset-x-0 bottom-0 z-30 space-y-3 border-t border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:sticky lg:inset-x-auto lg:top-6 lg:bottom-auto lg:rounded-2xl lg:border lg:p-4"
          }
        >
          <p className="font-display text-lg font-semibold">
            {picked.length} selected
          </p>
          <label className="block text-sm font-semibold">
            Assign to
            <select
              value={memberId}
              disabled={pending || assignNote !== undefined}
              onChange={(event) => setMemberId(event.currentTarget.value)}
              className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-3 text-base"
            >
              <option value="">Pick a person</option>
              {assignAction && <option value={unassign}>Unassign</option>}
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="text-sm text-overdue">
              {error}
            </p>
          )}
          {assignNote !== undefined && (
            <p id={`${id}-reason`} className="text-sm text-muted">
              {assignNote}
            </p>
          )}
          {assignNote === undefined && !picked.length && (
            <p id={`${id}-reason`} className="text-sm text-muted">
              Select leads to assign
            </p>
          )}
          {assignNote === undefined && picked.length > 0 && !memberId && (
            <p id={`${id}-reason`} className="text-sm text-muted">
              Pick a person to assign to
            </p>
          )}
          <button
            type="button"
            onClick={assign}
            disabled={
              pending ||
              assignNote !== undefined ||
              picked.length === 0 ||
              !memberId
            }
            aria-describedby={
              assignNote !== undefined || !picked.length || !memberId
                ? `${id}-reason`
                : undefined
            }
            className="min-h-14 w-full rounded-xl bg-brand px-4 font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
          >
            {buttonLabel()}
          </button>
        </section>
      </div>
    </div>
  );
}
