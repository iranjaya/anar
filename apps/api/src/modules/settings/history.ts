import {
  fields,
  lostReasons,
  outcomes,
  readCompanyScope,
  stages,
  type TenantTx,
} from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import type { HistoryReferences } from "@anar/domain/leads";
import { and, eq, inArray, isNull } from "drizzle-orm";

type Input = {
  fieldKeys: string[];
  stageIds: string[];
  outcomeIds: string[];
  lostReasonIds: string[];
};

const history = {
  async readOutcomeFacts(
    tx: TenantTx,
    outcomeId: string,
  ): Promise<{ countsAsFailed: boolean; isSiteVisit: boolean }> {
    const { companyId } = await readCompanyScope(tx);
    const [outcome] = await tx
      .select({
        countsAsFailed: outcomes.countsAsFailed,
        seedKey: outcomes.seedKey,
      })
      .from(outcomes)
      .where(
        and(
          eq(outcomes.companyId, companyId),
          eq(outcomes.id, outcomeId),
          isNull(outcomes.archivedAt),
        ),
      );
    if (!outcome) throw new AppError("validation", "Choose an active outcome");
    return {
      countsAsFailed: outcome.countsAsFailed,
      isSiteVisit: outcome.seedKey === "site_visit_done",
    };
  },
  // Archived rows are included: old leads and events still point at them.
  async loadHistoricalReferences(
    tx: TenantTx,
    input: Input,
  ): Promise<Omit<HistoryReferences, "actors">> {
    await readCompanyScope(tx);
    return {
      fields: input.fieldKeys.length
        ? await tx
            .select({
              id: fields.id,
              companyId: fields.companyId,
              key: fields.key,
              label: fields.label,
              type: fields.type,
              options: fields.options,
              isSystem: fields.isSystem,
              position: fields.position,
              archivedAt: fields.archivedAt,
            })
            .from(fields)
            .where(inArray(fields.key, input.fieldKeys))
        : [],
      stages: input.stageIds.length
        ? await tx
            .select({
              id: stages.id,
              companyId: stages.companyId,
              name: stages.name,
              position: stages.position,
              kind: stages.kind,
              isDefault: stages.isDefault,
            })
            .from(stages)
            .where(inArray(stages.id, input.stageIds))
        : [],
      outcomes: input.outcomeIds.length
        ? await tx
            .select({
              id: outcomes.id,
              companyId: outcomes.companyId,
              name: outcomes.name,
              countsAsFailed: outcomes.countsAsFailed,
              position: outcomes.position,
            })
            .from(outcomes)
            .where(inArray(outcomes.id, input.outcomeIds))
        : [],
      lostReasons: input.lostReasonIds.length
        ? await tx
            .select({
              id: lostReasons.id,
              companyId: lostReasons.companyId,
              name: lostReasons.name,
              position: lostReasons.position,
            })
            .from(lostReasons)
            .where(inArray(lostReasons.id, input.lostReasonIds))
        : [],
    };
  },
};
export default history;
