"use client";

import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { formatDue } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { ScoreBadge } from "@/modules/scoring/components";
import type { Stage } from "@/modules/settings/types";
import type { Lead } from "../types";
import { CallButton } from "./CallButton";

const secondary =
  "inline-flex min-h-14 items-center justify-center rounded-xl border border-line-strong bg-surface px-4 font-semibold text-ink-2 hover:border-brand focus-visible:outline-2 focus-visible:outline-brand";

export function LeadHeader({
  lead,
  stage,
  now,
}: {
  lead: Lead;
  stage: Stage;
  now: Date;
}) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const query = new URLSearchParams(useSearchParams());
  query.set("log", "1");
  return (
    <header className="grid min-w-0 gap-5 border-b border-line pb-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <p className="mb-2 text-sm font-medium text-muted">Lead details</p>
        <h1 className="break-words font-display text-3xl font-bold tracking-tight">
          {lead.fullName ?? formatPhone(lead.phoneE164)}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <ScoreBadge priority={lead.priority} score={lead.score} />
          <span className="rounded-lg border border-line bg-surface px-3 py-1 text-sm text-ink-2">
            {stage.name}
          </span>
          {stage.kind === "open" && lead.nextActionAt && (
            <span
              className={`text-sm font-semibold ${lead.nextActionAt < now ? "text-overdue" : "text-due"}`}
            >
              {formatDue(lead.nextActionAt, now)}
            </span>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        <CallButton
          leadId={lead.id}
          phoneE164={lead.phoneE164}
          phoneValid={lead.phoneValid}
          slug={slug}
        />
        {lead.phoneValid && lead.phoneE164 && (
          <a
            href={`https://wa.me/${lead.phoneE164.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            className={secondary}
          >
            WhatsApp
          </a>
        )}
        {lead.email && (
          <a href={`mailto:${lead.email}`} className={secondary}>
            Email
          </a>
        )}
        <Link
          href={`${pathname}?${query}`}
          className={`${secondary} fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 shadow-lg lg:static lg:shadow-none`}
        >
          Log a call
        </Link>
      </div>
    </header>
  );
}
