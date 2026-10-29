import { formatDay } from "@/lib/dates";
import type { CompanySchema } from "@/modules/settings/types";
import type { FollowUp, LeadEvent } from "../types";

const labels: Record<LeadEvent["type"], string> = {
  imported: "Lead imported",
  duplicate_import: "Imported again",
  assigned: "Lead assigned",
  unassigned: "Lead unassigned",
  stage_changed: "Stage changed",
  follow_up_logged: "Call logged",
  fields_updated: "Details updated",
  score_changed: "Score changed",
  lost_suggested: "Lost suggested",
  lost_suggestion_dismissed: "Keep trying",
  merged: "Leads merged",
  note_added: "Note added",
  created_manually: "Lead created",
};

export function Timeline({
  events,
  followUps,
  schema,
  now,
}: {
  events: LeadEvent[];
  followUps: FollowUp[];
  schema: CompanySchema;
  now: Date;
}) {
  return (
    <section
      aria-label="Timeline"
      className="rounded-2xl border border-line bg-surface p-5"
    >
      <h2 className="mb-5 font-display text-xl font-semibold">Timeline</h2>
      {events.length === 0 && (
        <p className="text-sm text-muted">No activity yet.</p>
      )}
      <ol className="space-y-5">
        {events.map((event) => {
          const call =
            event.type === "follow_up_logged"
              ? followUps.find((call) => call.id === event.data.followUpId)
              : undefined;
          const outcome =
            call &&
            schema.outcomes.find((outcome) => outcome.id === call.outcomeId);
          const stage =
            event.type === "stage_changed" &&
            schema.stages.find((stage) => stage.id === event.data.to);
          const reason =
            event.type === "stage_changed" &&
            schema.lostReasons.find(
              (reason) => reason.id === event.data.lostReasonId,
            );
          let title = labels[event.type];
          if (outcome) title = outcome.name;
          if (stage) title = `Moved to ${stage.name}`;
          return (
            <li key={event.id} className="border-l-2 border-line pl-4">
              <time
                dateTime={event.createdAt.toISOString()}
                className="text-sm text-muted"
              >
                {formatDay(event.createdAt, now)}
              </time>
              <h3 className="mt-1 font-semibold text-ink-2">{title}</h3>
              {call?.notes && (
                <p className="mt-1 break-words text-sm text-muted">
                  {call.notes}
                </p>
              )}
              {call?.nextActionAt && (
                <p className="mt-1 text-sm text-muted">
                  Next: {formatDay(call.nextActionAt, now)}
                </p>
              )}
              {reason && (
                <p className="mt-1 text-sm text-muted">{reason.name}</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
