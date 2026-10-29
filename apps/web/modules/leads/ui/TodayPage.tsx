import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PageShell } from "@/components/PageShell";
import { AppError } from "@/lib/errors";
import { loadSchema } from "@/modules/settings/server";
import type { CompanySchema } from "@/modules/settings/types";
import { can, homeFor, requireContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import { getLead, getMyToday } from "../server";
import type { LeadDetail } from "../types";
import { LeadDetailView } from "./LeadDetailView";
import { TodaySection } from "./TodaySection";

export async function TodayPage({
  params,
  searchParams,
  callSheet,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lead?: string | string[] }>;
  callSheet?: (leadId: string) => ReactNode;
}) {
  const { slug } = await params;
  const { lead } = await searchParams;
  const pickedLeadId = typeof lead === "string" ? lead : undefined;
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
            />
          )
        }
      />
      {today && selectedLeadId && callSheet?.(selectedLeadId)}
    </PageShell>
  );
}
