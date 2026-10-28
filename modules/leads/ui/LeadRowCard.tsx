import Link from "next/link";
import { formatDue } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { ScoreBadge } from "@/modules/scoring/components";
import type { LeadRow } from "../types";
import { CallButton } from "./CallButton";

export function LeadRowCard({
  lead,
  slug,
  now,
}: {
  lead: LeadRow;
  slug: string;
  now: Date;
}) {
  return (
    <article className="min-w-0 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link
          href={`/${slug}/leads/${lead.id}`}
          className="min-h-11 min-w-0 flex-1 break-words py-2 font-display text-lg leading-snug font-semibold tracking-tight underline-offset-4 hover:text-brand hover:underline"
        >
          {lead.fullName ?? formatPhone(lead.phoneE164)}
        </Link>
        <ScoreBadge priority={lead.priority} score={lead.score} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span className="rounded-md bg-bg px-2 py-1 text-ink-2">
          {lead.stage.name}
        </span>
        <span className="tabular-nums">{formatPhone(lead.phoneE164)}</span>
      </div>
      {lead.answers.length > 0 && (
        <p className="mt-2 break-words text-sm text-ink-2">
          {lead.answers.map((answer) => answer.label).join(" · ")}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          {lead.nextActionAt && (
            <p
              className={
                lead.bucket === "overdue"
                  ? "font-semibold text-overdue"
                  : "text-due"
              }
            >
              {formatDue(lead.nextActionAt, now)}
            </p>
          )}
          {lead.failedAttempts > 0 && (
            <p className="mt-1 text-muted">
              {lead.failedAttempts}{" "}
              {lead.failedAttempts === 1 ? "try" : "tries"}, no answer
            </p>
          )}
        </div>
        <CallButton
          leadId={lead.id}
          phoneE164={lead.phoneE164}
          phoneValid={lead.phoneValid}
          slug={slug}
        />
      </div>
    </article>
  );
}
