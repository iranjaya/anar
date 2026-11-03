import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type DismissLostSuggestionInput,
  dismissLostSuggestionInputSchema,
  type Lead,
} from "@anar/domain/leads";
import { sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import audit from "../tenant/audit.js";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import access from "./access.js";
import events from "./events.js";
import repository from "./repository.js";

export type LeadSuggestionDeps = {
  context: Pick<
    ReturnType<typeof tenant.create>,
    "requireContext" | "withContext"
  >;
  now(): Date;
};

const suggestion = {
  create(deps: LeadSuggestionDeps) {
    return {
      requireContext(
        request: Pick<FastifyRequest, "headers">,
        slug: string,
      ): Promise<Ctx> {
        return deps.context.requireContext(request, slug);
      },
      dismissLostSuggestion(
        actor: Ctx,
        raw: DismissLostSuggestionInput,
        meta: { ip: string | null },
      ): Promise<{ lead: Lead }> {
        const parsed = dismissLostSuggestionInputSchema.safeParse(raw);
        if (!parsed.success)
          throw new AppError("validation", "Choose the current suggestion");
        const at = deps.now();
        return deps.context.withContext(actor, async (tx, current) => {
          const lead = await access.visibleLead(
            tx,
            current,
            parsed.data.leadId,
            "leads.assign",
            true,
          );
          const eventId = await suggestion.currentEventId(
            tx,
            current.companyId,
            lead,
          );
          if (!eventId || eventId !== parsed.data.suggestionEventId)
            throw new AppError("conflict", "This suggestion has changed");
          const updated = await repository.updateLead(tx, lead.id, {
            failedAttempts: 0,
            lostSuggestedAt: null,
            updatedAt: at,
          });
          await events.insert(
            tx,
            current.companyId,
            {
              actorUserId: current.user.id,
              actorMemberId: current.member?.id ?? null,
            },
            [
              {
                leadId: lead.id,
                type: "lost_suggestion_dismissed",
                data: { suggestionEventId: eventId },
              },
            ],
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
            "leads.suggestion_dismissed",
            { type: "lead", id: lead.id },
            { suggestionEventId: eventId },
          );
          return { lead: updated };
        });
      },
    };
  },

  async currentEventId(
    tx: TenantTx,
    companyId: string,
    lead: Pick<Lead, "id" | "lostSuggestedAt">,
  ): Promise<string | null> {
    if (!lead.lostSuggestedAt) return null;
    const { rows } = await tx.execute<{ id: string }>(sql`SELECT id
      FROM lead_events WHERE company_id = ${companyId} AND lead_id = ${lead.id}
        AND type = 'lost_suggested'
      ORDER BY created_at DESC, id DESC LIMIT 1`);
    return rows[0]?.id ?? null;
  },
};
export type LeadSuggestionService = ReturnType<typeof suggestion.create>;
export default suggestion;
