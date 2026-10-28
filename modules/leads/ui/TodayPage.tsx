import { redirect } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { loadSchema } from "@/modules/settings/server";
import { can, homeFor, requireContext } from "@/modules/tenant/server";
import { getMyToday } from "../server";
import { TodaySection } from "./TodaySection";

export async function TodayPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await requireContext(slug);
  if (!ctx.member || !can(ctx, "reports.view_own")) redirect(homeFor(ctx));
  const [today, schema] = await Promise.all([getMyToday(ctx), loadSchema(ctx)]);
  return (
    <PageShell wide className="lg:pt-8">
      <header className="mb-6 border-b border-line pb-6 lg:mb-8">
        <p className="mb-2 text-sm font-medium text-muted">
          {ctx.member.name} · Your daily calls
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight lg:text-4xl">
          My Leads Today
        </h1>
      </header>
      <TodaySection
        key={`${ctx.companyId}/${ctx.member.id}`}
        rows={[...today.overdue, ...today.dueToday, ...today.newLeads]}
        counts={today.counts}
        hasAssignedLeads={today.hasAssignedLeads}
        stages={schema.stages}
        slug={slug}
        now={new Date()}
      />
    </PageShell>
  );
}
