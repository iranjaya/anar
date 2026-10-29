import { WhyScore } from "@/modules/scoring/components";
import type { CompanySchema } from "@/modules/settings/types";
import type { Ctx } from "@/modules/tenant/types";
import type { LeadDetail } from "../types";
import { Facts } from "./Facts";
import { LeadHeader } from "./LeadHeader";
import { LostSuggestion } from "./LostSuggestion";
import { Timeline } from "./Timeline";

export function LeadDetailView({
  detail,
  schema,
  ctx,
}: {
  detail: LeadDetail;
  schema: CompanySchema;
  ctx: Ctx;
}) {
  const stage = schema.stages.find((stage) => stage.id === detail.lead.stageId);
  if (!stage) throw new Error("Lead stage not found.");
  const lostStage = schema.stages.find((stage) => stage.kind === "lost");
  const showSuggestion =
    ctx.role !== "admin" && detail.lead.lostSuggestedAt !== null;
  if (showSuggestion && !lostStage) throw new Error("Lost stage not found.");
  const now = new Date();
  return (
    <section aria-label="Lead detail" className="min-w-0 space-y-6">
      <LeadHeader
        key={detail.lead.id}
        lead={detail.lead}
        stage={stage}
        now={now}
        canLogCall={ctx.role !== "dna"}
      />
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 space-y-5">
          <WhyScore
            breakdown={detail.lead.scoreBreakdown}
            fields={schema.fields}
            hotMin={detail.hotMin}
          />
          <Facts lead={detail.lead} fields={detail.fields} now={now} />
        </div>
        <div className="min-w-0 space-y-5">
          {showSuggestion && lostStage && (
            <LostSuggestion
              key={detail.lead.id}
              leadId={detail.lead.id}
              failedAttempts={detail.lead.failedAttempts}
              lostStageId={lostStage.id}
              reasons={schema.lostReasons}
            />
          )}
          <Timeline
            events={detail.events}
            followUps={detail.followUps}
            schema={schema}
            now={now}
          />
        </div>
      </div>
    </section>
  );
}
