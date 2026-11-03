import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type FieldsUpdatedData,
  type Lead,
  type ScoreChangedData,
  type UpdateLeadFieldsInput,
  updateLeadFieldsInputSchema,
} from "@anar/domain/leads";
import type {
  ScoreInput,
  ScoreResult,
  ScoringConfig,
} from "@anar/domain/scoring";
import type { CompanySchema } from "@anar/domain/settings";
import type { FastifyRequest } from "fastify";
import audit from "../tenant/audit.js";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import access from "./access.js";
import events from "./events.js";
import repository from "./repository.js";
import validation from "./validation.js";

export type LeadUpdateDeps = {
  context: Pick<
    ReturnType<typeof tenant.create>,
    "requireContext" | "withContext"
  >;
  now(): Date;
  loadSchema(tx: TenantTx): Promise<CompanySchema>;
  loadActiveConfig(tx: TenantTx): Promise<ScoringConfig>;
  scoreLead(input: ScoreInput, config: ScoringConfig): ScoreResult;
};

const update = {
  create(deps: LeadUpdateDeps) {
    return {
      requireContext(
        request: Pick<FastifyRequest, "headers">,
        slug: string,
      ): Promise<Ctx> {
        return deps.context.requireContext(request, slug);
      },
      async updateLeadFields(
        actor: Ctx,
        raw: UpdateLeadFieldsInput,
        meta: { ip: string | null },
      ): Promise<{ lead: Lead }> {
        const parsed = updateLeadFieldsInputSchema.safeParse(raw);
        if (!parsed.success)
          throw new AppError("validation", "These changes are not valid");
        const { leadId, ...input } = parsed.data;
        const at = deps.now();
        return deps.context.withContext(actor, async (tx, current) => {
          const lead = await access.visibleLead(
            tx,
            current,
            leadId,
            "leads.update",
            true,
          );
          const { fields } = await deps.loadSchema(tx);
          const patch = validation.patch(
            lead,
            input,
            fields,
            current.company.defaultCountry,
          );
          if (!patch.keys.length && !patch.systemKeys.length) return { lead };
          if (
            patch.set.phoneE164 &&
            (await repository.hasLivePhone(tx, patch.set.phoneE164, lead.id))
          )
            throw new AppError(
              "conflict",
              "Another lead already has this phone",
            );
          const score = patch.custom
            ? deps.scoreLead(
                { custom: patch.custom },
                await deps.loadActiveConfig(tx),
              )
            : null;
          const updated = await repository.updateLead(tx, lead.id, {
            ...patch.set,
            ...(patch.custom && score
              ? {
                  custom: patch.custom,
                  score: score.score,
                  priority: score.priority,
                  scoreBreakdown: score.breakdown,
                  scoredAt: at,
                }
              : {}),
            updatedAt: at,
          });
          const changed: FieldsUpdatedData = {
            keys: patch.keys,
            systemKeys: patch.systemKeys,
          };
          const rows: Parameters<typeof events.insert>[3] = [
            { leadId: lead.id, type: "fields_updated", data: changed },
          ];
          if (score && score.priority !== lead.priority) {
            const scoreData: ScoreChangedData = {
              from: lead.priority,
              to: score.priority,
              score: score.score,
            };
            rows.push({
              leadId: lead.id,
              type: "score_changed",
              data: scoreData,
            });
          }
          await events.insert(
            tx,
            current.companyId,
            {
              actorUserId: current.user.id,
              actorMemberId: current.member?.id ?? null,
            },
            rows,
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
            "leads.updated",
            { type: "lead", id: lead.id },
            { count: String(patch.keys.length + patch.systemKeys.length) },
          );
          return { lead: updated };
        });
      },
    };
  },
};
export type LeadUpdateService = ReturnType<typeof update.create>;
export default update;
