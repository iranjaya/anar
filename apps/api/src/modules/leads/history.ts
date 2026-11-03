import type { TenantTx } from "@anar/db/tenant";
import type {
  FollowUp,
  HistoryReferences,
  Lead,
  LeadEvent,
  StageChangedData,
} from "@anar/domain/leads";

export type HistoryDeps = {
  loadHistoricalReferences(
    tx: TenantTx,
    input: {
      fieldKeys: string[];
      stageIds: string[];
      outcomeIds: string[];
      lostReasonIds: string[];
    },
  ): Promise<Omit<HistoryReferences, "actors">>;
  readProfiles(
    tx: TenantTx,
    userIds: string[],
  ): Promise<{ id: string; name: string }[]>;
};
type LeadRefs = Pick<
  Lead,
  "custom" | "scoreBreakdown" | "stageId" | "lostReasonId"
>;

const history = {
  // Only what this lead and these events point at, archived rows included.
  async references(
    deps: HistoryDeps,
    tx: TenantTx,
    lead: LeadRefs | null,
    events: Pick<
      LeadEvent,
      "type" | "data" | "actorUserId" | "actorMemberId"
    >[],
    followUps: FollowUp[] = [],
  ): Promise<HistoryReferences> {
    const moves = events.flatMap((event) =>
      event.type === "stage_changed" ? [event.data as StageChangedData] : [],
    );
    const fieldKeys = lead
      ? [
          ...new Set([
            ...Object.keys(lead.custom),
            ...Object.keys(lead.scoreBreakdown),
          ]),
        ]
      : [];
    const settings = await deps.loadHistoricalReferences(tx, {
      fieldKeys,
      stageIds: [
        ...new Set([
          ...(lead ? [lead.stageId] : []),
          ...moves.flatMap((move) => [move.from, move.to]),
          ...followUps.flatMap((call) => [
            call.stageBeforeId,
            call.stageAfterId,
          ]),
        ]),
      ],
      outcomeIds: [...new Set(followUps.map((call) => call.outcomeId))],
      lostReasonIds: [
        ...new Set(
          [
            lead?.lostReasonId,
            ...moves.map((move) => move.lostReasonId),
          ].filter((id): id is string => Boolean(id)),
        ),
      ],
    });
    const pairs = new Map(
      events.map((event) => [
        `${event.actorUserId}|${event.actorMemberId}`,
        event,
      ]),
    );
    const userIds = [...new Set(events.map((event) => event.actorUserId))];
    const profiles = await deps.readProfiles(tx, userIds);
    const names = new Map(
      profiles.map((profile) => [profile.id, profile.name]),
    );
    return {
      ...settings,
      actors: [...pairs.values()].map((event) => {
        const name = names.get(event.actorUserId);
        if (name === undefined) throw new Error("Event actor has no profile");
        return {
          userId: event.actorUserId,
          memberId: event.actorMemberId,
          name,
        };
      }),
    };
  },
};
export default history;
