import { createHash } from "node:crypto";
import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type LogFollowUpInput,
  type LogFollowUpResult,
  type LogFollowUpWireInput,
  logFollowUpInputSchema,
  logFollowUpResultSchema,
  logFollowUpWire,
} from "@anar/domain/followups";
import type {
  ApplyFollowUpInput,
  ApplyFollowUpResult,
  Bucket,
  Lead,
} from "@anar/domain/leads";
import type { NotificationInput } from "@anar/domain/notifications";
import type { FastifyRequest } from "fastify";
import { v7 } from "uuid";
import audit from "../tenant/audit.js";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import repository from "./repository.js";

export type FollowUpDeps = {
  context: Pick<
    ReturnType<typeof tenant.create>,
    "requireContext" | "withContext"
  >;
  now(): Date;
  readVisibleLead(
    tx: TenantTx,
    current: Ctx,
    leadId: string,
    lock: boolean,
  ): Promise<Lead>;
  readOutcomeFacts(
    tx: TenantTx,
    outcomeId: string,
  ): Promise<{ countsAsFailed: boolean; isSiteVisit: boolean }>;
  readOriginalBucket(
    tx: TenantTx,
    current: Ctx,
    leadId: string,
    at: Date,
  ): Promise<Bucket | null>;
  applyFollowUp(
    tx: TenantTx,
    current: Ctx,
    input: ApplyFollowUpInput,
    meta: { ip: string | null },
  ): Promise<ApplyFollowUpResult>;
  nextLeadId(
    tx: TenantTx,
    current: Ctx,
    input: { originalBucket: Bucket; excludeLeadId: string; at: Date },
  ): Promise<string | null>;
  canReceiveCompanyNotification(tx: TenantTx, userId: string): Promise<boolean>;
  notify(tx: TenantTx, input: NotificationInput): Promise<{ id: string }>;
};

const followUps = {
  create(deps: FollowUpDeps) {
    return {
      requireContext(
        request: Pick<FastifyRequest, "headers">,
        slug: string,
      ): Promise<Ctx> {
        return deps.context.requireContext(request, slug);
      },
      logFollowUp(
        actor: Ctx,
        raw: LogFollowUpWireInput,
        meta: { ip: string | null },
      ): Promise<LogFollowUpResult> {
        const parsed = logFollowUpInputSchema.safeParse(raw);
        if (!parsed.success)
          throw new AppError(
            "validation",
            "Check this call and follow-up date",
          );
        const input = parsed.data;
        const at = deps.now();
        return deps.context.withContext(actor, async (tx, current) => {
          const hash = followUps._hash(input);
          await repository.lockRequest(
            tx,
            current.companyId,
            current.user.id,
            input.requestId,
          );
          const saved = await repository.findRequest(
            tx,
            current.companyId,
            current.user.id,
            input.requestId,
          );
          if (saved) {
            if (saved.requestHash !== hash)
              throw new AppError("conflict", "This call request has changed");
            await deps.readVisibleLead(tx, current, saved.leadId, true);
            const result = logFollowUpResultSchema.parse(saved.response);
            const nextLeadId = await followUps._savedNext(
              deps,
              tx,
              current,
              result.nextLeadId,
              at,
            );
            return { ...result, nextLeadId };
          }
          const before = await deps.readVisibleLead(
            tx,
            current,
            input.leadId,
            true,
          );
          const originalBucket = current.member
            ? await deps.readOriginalBucket(tx, current, before.id, at)
            : null;
          const facts = await deps.readOutcomeFacts(tx, input.outcomeId);
          const followUpId = v7();
          const { lead, suggestionEventId } = await deps.applyFollowUp(
            tx,
            current,
            {
              leadId: before.id,
              followUpId,
              happenedAt: at,
              outcomeId: input.outcomeId,
              countsAsFailed: facts.countsAsFailed,
              nextActionAt: input.nextActionAt ?? null,
              stageId: input.stageId,
              lostReasonId: input.lostReasonId,
              custom: input.custom,
            },
            meta,
          );
          const nextLeadId = originalBucket
            ? await deps.nextLeadId(tx, current, {
                originalBucket,
                excludeLeadId: before.id,
                at,
              })
            : null;
          const result: LogFollowUpResult = {
            lead,
            followUp: {
              id: followUpId,
              companyId: current.companyId,
              leadId: lead.id,
              byMemberId: current.member?.id ?? null,
              byUserId: current.user.id,
              outcomeId: input.outcomeId,
              notes: input.notes ?? null,
              happenedAt: at,
              nextActionAt: lead.nextActionAt,
              stageBeforeId: before.stageId,
              stageAfterId: lead.stageId,
            },
            lostSuggested: suggestionEventId !== null,
            nextLeadId,
          };
          const response = logFollowUpWire(result);
          await repository.insert(tx, {
            followUp: result.followUp,
            requestId: input.requestId,
            requestHash: hash,
            countsAsFailed: facts.countsAsFailed,
            isSiteVisit: facts.isSiteVisit,
            response,
          });
          if (suggestionEventId)
            await followUps._notifyLostSuggestion(
              deps,
              tx,
              current,
              lead,
              suggestionEventId,
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
            "followups.logged",
            { type: "lead", id: lead.id },
            { followUpId, outcomeId: input.outcomeId },
          );
          return result;
        });
      },
    };
  },

  _hash(input: LogFollowUpInput): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
  },

  async _notifyLostSuggestion(
    deps: FollowUpDeps,
    tx: TenantTx,
    current: Ctx,
    lead: Lead,
    suggestionEventId: string,
  ): Promise<void> {
    const managers = await repository.activeManagerUserIds(
      tx,
      current.companyId,
    );
    for (const userId of managers) {
      if (!(await deps.canReceiveCompanyNotification(tx, userId))) continue;
      await deps.notify(tx, {
        companyId: current.companyId,
        userId,
        title: "Lead may be lost",
        body: `A lead has ${lead.failedAttempts} failed calls. Review it.`,
        url: `/${current.company.slug}/leads/${lead.id}`,
        dedupeKey: `lost:${current.companyId}:${lead.id}:${suggestionEventId}`,
        data: {
          type: "lost_suggested",
          leadId: lead.id,
          failedAttempts: lead.failedAttempts,
        },
      });
    }
  },

  async _savedNext(
    deps: FollowUpDeps,
    tx: TenantTx,
    current: Ctx,
    leadId: string | null,
    at: Date,
  ): Promise<string | null> {
    if (!leadId || !current.member) return null;
    try {
      await deps.readVisibleLead(tx, current, leadId, true);
      return (await deps.readOriginalBucket(tx, current, leadId, at))
        ? leadId
        : null;
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === "not_found" || error.code === "forbidden")
      )
        return null;
      throw error;
    }
  },
};
export type FollowUpService = ReturnType<typeof followUps.create>;
export default followUps;
