import type { TodayResult } from "@anar/domain/leads";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PageShell } from "@/components/PageShell";
import { dataMode } from "@/lib/api/mode";
import { formatDue } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { loadSchema } from "@/modules/settings/server";
import type { CompanySchema } from "@/modules/settings/types";
import {
  can,
  hasCapability,
  homeFor,
  requireContext,
  requireFeatureContext,
} from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import { getLead, getMyToday, getRealToday } from "../server";
import type { LeadDetail } from "../types";
import { LeadDetailView } from "./LeadDetailView";
import { TodaySection } from "./TodaySection";

export async function TodayPage({
  params,
  searchParams,
  callSheet,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lead?: string | string[]; log?: string | string[] }>;
  callSheet?: (leadId: string) => ReactNode;
}) {
  const { slug } = await params;
  const { lead, log } = await searchParams;
  const pickedLeadId = typeof lead === "string" ? lead : undefined;
  if (dataMode() === "real")
    return realToday(slug, pickedLeadId, log === "1" ? callSheet : undefined);
  let ctx: Ctx | null = null;
  let today: Awaited<ReturnType<typeof getMyToday>> | null = null;
  let schema: CompanySchema | null = null;
  let detail: LeadDetail | null = null;
  let selectedLeadId: string | undefined;
  try {
    ctx = await requireContext(slug);
    if (!ctx.member || !can(ctx, "reports.view_own")) redirect(homeFor(ctx));
    [today, schema] = await Promise.all([getMyToday(ctx), loadSchema(ctx)]);
    selectedLeadId =
      pickedLeadId ??
      today.overdue[0]?.id ??
      today.dueToday[0]?.id ??
      today.newLeads[0]?.id;
    if (selectedLeadId) detail = await getLead(ctx, selectedLeadId);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    if (!(error instanceof AppError) || error.code !== "unavailable") {
      throw error;
    }
    today = null;
  }
  return (
    <PageShell wide className="lg:pt-8">
      <header className="mb-6 border-b border-line pb-6 lg:mb-8">
        <p className="mb-2 text-sm font-medium text-muted">
          {ctx?.member && `${ctx.member.name} · `}Your daily calls
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight lg:text-4xl">
          My Leads Today
        </h1>
      </header>
      <TodaySection
        key={`${slug}/${ctx?.member?.id ?? ""}`}
        rows={
          today ? [...today.overdue, ...today.dueToday, ...today.newLeads] : []
        }
        counts={today?.counts ?? null}
        hasAssignedLeads={today?.hasAssignedLeads ?? false}
        stages={schema?.stages ?? []}
        slug={slug}
        now={new Date()}
        timezone={today?.timezone ?? "UTC"}
        selectedLeadId={selectedLeadId}
        leadPicked={Boolean(pickedLeadId && today)}
        detail={
          today &&
          detail &&
          schema &&
          ctx && (
            <LeadDetailView
              key={detail.lead.id}
              detail={detail}
              schema={schema}
              ctx={ctx}
              timezone={today.timezone}
            />
          )
        }
      />
      {today && selectedLeadId && log === "1" && callSheet?.(selectedLeadId)}
    </PageShell>
  );
}

// Real Today reads the three buckets; calls and full detail open from the lead page.
async function realToday(
  slug: string,
  pickedLeadId: string | undefined,
  callSheet?: (leadId: string) => ReactNode,
) {
  const view = await requireFeatureContext(slug);
  if (
    !("capabilities" in view) ||
    !view.member ||
    !hasCapability(view, "reports.view_own")
  )
    redirect(`/${slug}`);
  let today: TodayResult | null = null;
  try {
    today = await getRealToday(slug);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "unavailable")
      throw error;
  }
  const rows = today
    ? [...today.overdue, ...today.dueToday, ...today.newLeads]
    : [];
  const stages = [
    ...new Map(rows.map((row) => [row.stage.id, row.stage])).values(),
  ].map((stage, position) => ({ id: stage.id, name: stage.name, position }));
  const selected =
    rows.find((row) => row.id === pickedLeadId) ??
    (pickedLeadId ? undefined : rows[0]);
  if (today && pickedLeadId && !selected)
    redirect(`/${slug}/leads/${pickedLeadId}${callSheet ? "?log=1" : ""}`);
  const now = new Date();
  return (
    <PageShell wide className="lg:pt-8">
      <header className="mb-6 border-b border-line pb-6 lg:mb-8">
        <p className="mb-2 text-sm font-medium text-muted">
          {view.member.name} · Your daily calls
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight lg:text-4xl">
          My Leads Today
        </h1>
      </header>
      <TodaySection
        key={`${slug}/${view.member.id}`}
        rows={rows}
        counts={today?.counts ?? null}
        hasAssignedLeads={today?.hasAssignedLeads ?? false}
        stages={stages}
        slug={slug}
        now={now}
        timezone={view.company.timezone}
        selectedLeadId={selected?.id}
        leadPicked={Boolean(pickedLeadId && today)}
        cursors={
          today
            ? {
                overdue: today.nextCursors.overdue,
                due_today: today.nextCursors.dueToday,
                new: today.nextCursors.newLeads,
              }
            : undefined
        }
        detail={
          selected && (
            <section
              aria-label="Selected lead"
              className="min-w-0 rounded-2xl border border-line bg-surface p-5"
            >
              <h2 className="break-words font-display text-2xl font-bold">
                {selected.fullName ?? "No name"}
              </h2>
              <p className="mt-1 break-all font-mono text-sm text-muted">
                {selected.phoneE164 ?? "No valid phone"}
              </p>
              <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
                <dt>Stage</dt>
                <dd className="font-semibold">{selected.stage.name}</dd>
                <dt>Next call</dt>
                <dd className="font-semibold">
                  {selected.nextActionAt
                    ? formatDue(
                        selected.nextActionAt,
                        view.company.timezone,
                        now,
                      )
                    : "Not set"}
                </dd>
                <dt>Priority</dt>
                <dd className="font-semibold capitalize">
                  {selected.priority}
                </dd>
              </dl>
              <Link
                href={`/${slug}/leads/${selected.id}`}
                className="mt-5 flex min-h-14 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-surface"
              >
                Open lead
              </Link>
            </section>
          )
        }
      />
      {today && selected && callSheet?.(selected.id)}
    </PageShell>
  );
}
