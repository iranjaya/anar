import type { SettingsCatalog } from "@anar/domain/settings";
import { archiveLostReasonAction, upsertLostReasonAction } from "../actions";
import { NamedList } from "./NamedList";

export function LostReasonList({
  slug,
  lostReasons,
}: {
  slug: string;
  lostReasons: SettingsCatalog["lostReasons"];
}) {
  return (
    <>
      <p className="mt-1 text-sm text-muted">
        Archived reasons stay on leads already marked lost. New lost leads
        cannot pick them.
      </p>
      <NamedList
        slug={slug}
        noun="lost reason"
        rows={lostReasons}
        save={upsertLostReasonAction}
        archive={archiveLostReasonAction}
      />
    </>
  );
}
