import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageShell } from "@/components/PageShell";
import { ReadError } from "@/components/ReadError";
import { listTeam } from "@/modules/members/server";
import { WhyScore } from "@/modules/scoring/components";
import { loadSchema } from "@/modules/settings/server";
import { getCompanyContext } from "@/modules/tenant/server";
import { getLeadDetail, listLeadEvents } from "../data/leadDetail";
import { AssignLead } from "./AssignLead";
import { ChangeStage } from "./ChangeStage";
import { EditLeadFields } from "./EditLeadFields";
import { Facts } from "./Facts";
import { LeadHeader } from "./LeadHeader";
import { LostSuggestion } from "./LostSuggestion";
import { Timeline } from "./Timeline";

export async function LeadRecordPage({
  params,
  searchParams,
  callSheet,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{
    events?: string | string[];
    log?: string | string[];
  }>;
  callSheet?: ReactNode;
}) {
  const { slug, id } = await params;
  const { events: cursor, log } = await searchParams;
  const context = await getCompanyContext(slug);
  if (!context?.ok) notFound();
  const href = `/${slug}/leads/${id}`;
  const result = await getLeadDetail(slug, id);
  if (result && !result.ok && result.error === "not_found") notFound();
  if (!result?.ok)
    return (
      <PageShell wide className="lg:pb-10">
        <ReadError
          message={result?.message ?? "This lead could not be loaded."}
          href={href}
        />
      </PageShell>
    );
  const detail = result.data;
  const canEdit = context.data.capabilities.includes("leads.update");
  const canAssign = context.data.capabilities.includes("leads.assign");
  const [older, schema, team] = await Promise.all([
    typeof cursor === "string" ? listLeadEvents(slug, id, cursor) : null,
    canEdit ? loadSchema(context.data) : null,
    canAssign ? listTeam(slug) : null,
  ]);
  const timeline = older?.ok
    ? {
        events: older.data.events,
        followUps: older.data.followUps,
        history: older.data.history,
        next: older.data.nextCursor,
      }
    : {
        events: detail.events,
        followUps: detail.followUps,
        history: detail.history,
        next: detail.nextEventCursor,
      };
  const stage = detail.history.stages.find(
    (stage) => stage.id === detail.lead.stageId,
  );
  if (!stage) throw new Error("Lead stage not found.");
  const showSuggestion =
    canAssign &&
    detail.lead.lostSuggestedAt !== null &&
    detail.suggestionEventId !== null;
  const lostStage = schema?.stages.find((item) => item.kind === "lost");
  const now = new Date();
  return (
    <PageShell wide className="lg:pb-10">
      <section aria-label="Lead detail" className="min-w-0 space-y-6">
        <LeadHeader
          key={detail.lead.id}
          lead={detail.lead}
          stage={stage}
          now={now}
          timezone={context.data.company.timezone}
          canLogCall={context.data.capabilities.includes("followups.log")}
        />
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="min-w-0 space-y-5">
            <WhyScore
              breakdown={detail.lead.scoreBreakdown}
              fields={detail.history.fields}
              hotMin={detail.hotMin}
            />
            <Facts
              lead={detail.lead}
              fields={detail.fields}
              now={now}
              timezone={context.data.company.timezone}
            />
            {schema && (
              <EditLeadFields
                key={detail.lead.id}
                slug={slug}
                lead={detail.lead}
                fields={schema.fields.filter(
                  (field) => !field.isSystem && field.archivedAt === null,
                )}
              />
            )}
          </div>
          <div className="min-w-0 space-y-5">
            {showSuggestion && schema && (
              <LostSuggestion
                key={detail.suggestionEventId}
                leadId={detail.lead.id}
                failedAttempts={detail.lead.failedAttempts}
                lostStageId={lostStage?.id ?? null}
                reasons={schema.lostReasons}
                suggestionEventId={detail.suggestionEventId ?? undefined}
                real
              />
            )}
            {team?.ok && (
              <AssignLead
                key={detail.lead.assignedTo ?? "none"}
                slug={slug}
                leadId={detail.lead.id}
                assignedTo={detail.lead.assignedTo}
                members={team.data.filter(
                  (member) => member.status === "active",
                )}
              />
            )}
            {schema && (
              <ChangeStage
                key={`${detail.lead.stageId}/${detail.lead.lostReasonId}`}
                slug={slug}
                lead={detail.lead}
                stages={schema.stages}
                reasons={schema.lostReasons}
              />
            )}
            {older && !older.ok && (
              <ReadError message={older.message} href={href} />
            )}
            <Timeline
              events={timeline.events}
              followUps={timeline.followUps}
              schema={timeline.history}
              now={now}
              timezone={context.data.company.timezone}
              olderHref={
                timeline.next
                  ? `${href}?events=${encodeURIComponent(timeline.next)}`
                  : undefined
              }
            />
          </div>
        </div>
      </section>
      {log === "1" && callSheet}
    </PageShell>
  );
}
