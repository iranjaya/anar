import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type ApplyFollowUpInput,
  type ApplyFollowUpResult,
  type FieldsUpdatedData,
  type Lead,
  type ScoreChangedData,
  updateLeadFieldsInputSchema,
} from "@anar/domain/leads";
import type {
  ScoreInput,
  ScoreResult,
  ScoringConfig,
} from "@anar/domain/scoring";
import { v7 } from "uuid";
import type { Ctx } from "../tenant/index.js";
import access from "./access.js";
import events from "./events.js";
import repository from "./repository.js";
import stage, { type StageDeps } from "./stage.js";
import validation from "./validation.js";

export type LeadFollowUpDeps = StageDeps & {
  loadActiveConfig(tx: TenantTx): Promise<ScoringConfig>;
  scoreLead(input: ScoreInput, config: ScoringConfig): ScoreResult;
};

const followUp = {
  create(deps: LeadFollowUpDeps) {
    return {
      readVisibleLeadForCall: followUp.readVisibleLeadForCall,
      applyFollowUp(
        tx: TenantTx,
        current: Ctx,
        input: ApplyFollowUpInput,
        meta: { ip: string | null },
      ): Promise<ApplyFollowUpResult> {
        return followUp.applyFollowUp(tx, deps, current, input, meta);
      },
    };
  },

  readVisibleLeadForCall(
    tx: TenantTx,
    current: Ctx,
    leadId: string,
    lock = false,
  ): Promise<Lead> {
    return access.visibleLead(tx, current, leadId, "followups.log", lock);
  },

  async applyFollowUp(
    tx: TenantTx,
    deps: LeadFollowUpDeps,
    current: Ctx,
    input: ApplyFollowUpInput,
    meta: { ip: string | null },
  ): Promise<ApplyFollowUpResult> {
    const before = await followUp.readVisibleLeadForCall(
      tx,
      current,
      input.leadId,
      true,
    );
    const stageId = input.stageId ?? before.stageId;
    let lostReasonId = input.lostReasonId;
    if (lostReasonId === undefined)
      lostReasonId = stageId === before.stageId ? before.lostReasonId : null;
    const { lead } = await stage.applyStageChange(
      tx,
      deps,
      current,
      before,
      { stageId, lostReasonId },
      { at: input.happenedAt, ip: meta.ip },
    );
    const references = await deps.loadHistoricalReferences(tx, {
      fieldKeys: [],
      stageIds: [lead.stageId],
      outcomeIds: [],
      lostReasonIds: [],
    });
    const kind = references.stages[0]?.kind;
    if (!kind) throw new Error("Lead stage is missing");
    const hasCustom = input.custom && Object.keys(input.custom).length > 0;
    if (
      hasCustom &&
      !updateLeadFieldsInputSchema.safeParse({
        leadId: input.leadId,
        custom: input.custom,
      }).success
    )
      throw new AppError("validation", "These changes are not valid");
    const patch = hasCustom
      ? validation.patch(
          lead,
          { custom: input.custom },
          (await deps.loadSchema(tx)).fields,
          current.company.defaultCountry,
        )
      : null;
    const score = patch?.custom
      ? deps.scoreLead(
          { custom: patch.custom },
          await deps.loadActiveConfig(tx),
        )
      : null;
    const failedAttempts = input.countsAsFailed ? lead.failedAttempts + 1 : 0;
    const suggested =
      kind === "open" && failedAttempts >= 5 && lead.lostSuggestedAt === null;
    const suggestionEventId = suggested ? v7() : null;
    const updated = await repository.updateLead(tx, lead.id, {
      nextActionAt: kind === "open" ? input.nextActionAt : null,
      lastContactedAt: input.happenedAt,
      failedAttempts,
      ...(suggested ? { lostSuggestedAt: input.happenedAt } : {}),
      ...(patch?.custom && score
        ? {
            custom: patch.custom,
            score: score.score,
            priority: score.priority,
            scoreBreakdown: score.breakdown,
            scoredAt: input.happenedAt,
          }
        : {}),
      updatedAt: input.happenedAt,
    });
    const rows: Parameters<typeof events.insert>[3] = [
      {
        leadId: lead.id,
        type: "follow_up_logged",
        data: { followUpId: input.followUpId, outcomeId: input.outcomeId },
      },
    ];
    if (patch?.keys.length) {
      const data: FieldsUpdatedData = { keys: patch.keys, systemKeys: [] };
      rows.push({ leadId: lead.id, type: "fields_updated", data });
    }
    if (score && score.priority !== lead.priority) {
      const data: ScoreChangedData = {
        from: lead.priority,
        to: score.priority,
        score: score.score,
      };
      rows.push({ leadId: lead.id, type: "score_changed", data });
    }
    if (suggestionEventId)
      rows.push({
        id: suggestionEventId,
        leadId: lead.id,
        type: "lost_suggested",
        data: { followUpId: input.followUpId, failedAttempts },
      });
    await events.insert(
      tx,
      current.companyId,
      {
        actorUserId: current.user.id,
        actorMemberId: current.member?.id ?? null,
      },
      rows,
    );
    return { lead: updated, suggestionEventId };
  },
};
export type LeadFollowUpService = ReturnType<typeof followUp.create>;
export default followUp;
