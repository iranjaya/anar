import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type ChangeStageInput,
  changeStageInputSchema,
  type Lead,
  type StageChangedData,
} from "@anar/domain/leads";
import type { CompanySchema, Stage } from "@anar/domain/settings";
import type { FastifyRequest } from "fastify";
import audit from "../tenant/audit.js";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import access from "./access.js";
import events from "./events.js";
import type { HistoryDeps } from "./history.js";
import repository from "./repository.js";
import suggestion from "./suggestion.js";

export type StageDeps = Pick<HistoryDeps, "loadHistoricalReferences"> & {
  loadSchema(tx: TenantTx): Promise<CompanySchema>;
};
export type LeadStageDeps = StageDeps & {
  context: Pick<
    ReturnType<typeof tenant.create>,
    "requireContext" | "withContext"
  >;
  now(): Date;
};
type Move = Pick<ChangeStageInput, "stageId" | "lostReasonId">;
type Plan = {
  set: Partial<
    Pick<
      Lead,
      | "stageId"
      | "lostReasonId"
      | "nextActionAt"
      | "lostSuggestedAt"
      | "failedAttempts"
    >
  >;
  data: StageChangedData;
};

const stage = {
  create(deps: LeadStageDeps) {
    return {
      requireContext(
        request: Pick<FastifyRequest, "headers">,
        slug: string,
      ): Promise<Ctx> {
        return deps.context.requireContext(request, slug);
      },
      async changeStage(
        actor: Ctx,
        raw: ChangeStageInput,
        meta: { ip: string | null },
      ): Promise<{ lead: Lead }> {
        const parsed = changeStageInputSchema.safeParse(raw);
        if (!parsed.success)
          throw new AppError("validation", "This stage change is not valid");
        const { leadId, suggestionEventId, ...move } = parsed.data;
        const at = deps.now();
        return deps.context.withContext(actor, async (tx, current) => {
          const lead = await access.visibleLead(
            tx,
            current,
            leadId,
            "leads.update",
            true,
          );
          if (suggestionEventId) {
            const currentEventId = await suggestion.currentEventId(
              tx,
              current.companyId,
              lead,
            );
            if (currentEventId !== suggestionEventId)
              throw new AppError("conflict", "This suggestion has changed");
          }
          const result = await stage.applyStageChange(
            tx,
            deps,
            current,
            lead,
            move,
            { at, ip: meta.ip },
          );
          return { lead: result.lead };
        });
      },
    };
  },

  // Runs in the caller's transaction on a lead it has already locked and checked; follow-ups reuse it.
  async applyStageChange(
    tx: TenantTx,
    deps: StageDeps,
    current: Ctx,
    lead: Lead,
    move: Move,
    meta: { at: Date; ip: string | null },
  ): Promise<{ lead: Lead; changed: boolean }> {
    const schema = await deps.loadSchema(tx);
    const {
      stages: [from],
    } = await deps.loadHistoricalReferences(tx, {
      fieldKeys: [],
      stageIds: [lead.stageId],
      outcomeIds: [],
      lostReasonIds: [],
    });
    if (!from) throw new Error("Lead stage is missing");
    const plan = stage._plan(lead, from, schema, move);
    if (!plan) return { lead, changed: false };
    const updated = await repository.updateLead(tx, lead.id, {
      ...plan.set,
      updatedAt: meta.at,
    });
    await events.insert(
      tx,
      current.companyId,
      {
        actorUserId: current.user.id,
        actorMemberId: current.member?.id ?? null,
      },
      [{ leadId: lead.id, type: "stage_changed", data: plan.data }],
    );
    await audit.audit(
      tx,
      {
        user: current.user,
        role: current.role,
        agencyId: current.agencyId,
        companyId: current.companyId,
        ip: meta.ip,
      },
      "leads.stage_changed",
      { type: "lead", id: lead.id },
      { stageId: plan.data.to },
    );
    return { lead: updated, changed: true };
  },

  // Null means nothing changes. An archived current stage is only ever reached as that no-op.
  _plan(
    lead: Pick<Lead, "stageId" | "lostReasonId">,
    from: Stage,
    schema: Pick<CompanySchema, "stages" | "lostReasons">,
    move: Move,
  ): Plan | null {
    const lostReasonId = move.lostReasonId ?? null;
    if (move.stageId === lead.stageId && lostReasonId === lead.lostReasonId)
      return null;
    const to = schema.stages.find((stage) => stage.id === move.stageId);
    if (!to) throw new AppError("validation", "Choose an active stage");
    if (
      to.kind === "lost" &&
      !schema.lostReasons.some((reason) => reason.id === lostReasonId)
    )
      throw new AppError("validation", "Choose why the lead was lost");
    if (to.kind !== "lost" && lostReasonId !== null)
      throw new AppError("validation", "Only a lost stage takes a reason");
    const set: Plan["set"] = { stageId: to.id, lostReasonId };
    if (to.kind !== "open") set.nextActionAt = null;
    if (to.kind === "lost") set.lostSuggestedAt = null;
    if (from.kind !== "open" && to.kind === "open") set.failedAttempts = 0;
    return {
      set,
      data: {
        from: from.id,
        to: to.id,
        fromKind: from.kind,
        toKind: to.kind,
        lostReasonId,
      },
    };
  },
};
export type LeadStageService = ReturnType<typeof stage.create>;
export default stage;
