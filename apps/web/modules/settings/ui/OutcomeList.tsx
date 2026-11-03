import type { SettingsCatalog } from "@anar/domain/settings";
import { archiveOutcomeAction, upsertOutcomeAction } from "../actions";
import { NamedList } from "./NamedList";

export function OutcomeList({
  slug,
  outcomes,
}: {
  slug: string;
  outcomes: SettingsCatalog["outcomes"];
}) {
  return (
    <>
      <p className="mt-1 text-sm text-muted">
        Five failed attempts in a row suggest marking the lead lost. A change to
        the failed box counts for calls logged after it.
      </p>
      <NamedList
        slug={slug}
        noun="call outcome"
        flagLabel="Counts as a failed attempt"
        rows={outcomes.map((outcome) => ({
          id: outcome.id,
          name: outcome.name,
          flag: outcome.countsAsFailed,
          archivedAt: outcome.archivedAt,
        }))}
        save={upsertOutcomeAction}
        archive={archiveOutcomeAction}
      />
    </>
  );
}
