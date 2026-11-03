import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type LeadEvent,
  type LeadEventsQuery,
  type LeadTimelinePage,
  leadEventsQuerySchema,
  leadIdQuerySchema,
  type RealLeadDetail,
} from "@anar/domain/leads";
import type { ScoringConfig } from "@anar/domain/scoring";
import type { FastifyRequest } from "fastify";
import { readFollowUpsForEvents } from "../followups/index.js";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import access from "./access.js";
import cursor from "./cursor.js";
import history, { type HistoryDeps } from "./history.js";
import repository from "./repository.js";
import suggestion from "./suggestion.js";

export type LeadDetailDeps = HistoryDeps & {
  context: Pick<
    ReturnType<typeof tenant.create>,
    "requireContext" | "withContext"
  >;
  loadActiveConfig(tx: TenantTx): Promise<ScoringConfig>;
};
const pageSize = 50;
const invalidPage = "This page of history is not valid";

const detail = {
  create(deps: LeadDetailDeps) {
    return {
      requireContext(
        request: Pick<FastifyRequest, "headers">,
        slug: string,
      ): Promise<Ctx> {
        return deps.context.requireContext(request, slug);
      },
      async getLead(
        actor: Ctx,
        raw: { leadId: string },
      ): Promise<RealLeadDetail> {
        const parsed = leadIdQuerySchema.safeParse(raw);
        if (!parsed.success) throw new AppError("not_found", "Lead not found");
        return deps.context.withContext(actor, async (tx, current) => {
          const lead = await access.visibleLead(
            tx,
            current,
            parsed.data.leadId,
            "leads.view",
          );
          const suggestionEventId = await suggestion.currentEventId(
            tx,
            current.companyId,
            lead,
          );
          const { hotMin } = await deps.loadActiveConfig(tx);
          const page = await detail._events(tx, lead.id, null);
          const followUps = await detail._followUps(
            tx,
            current.companyId,
            lead.id,
            page.events,
          );
          const refs = await history.references(
            deps,
            tx,
            lead,
            page.events,
            followUps,
          );
          const fields = refs.fields
            .filter((field) => {
              const value = lead.custom[field.key];
              return value !== null && value !== undefined && value !== "";
            })
            .sort((a, b) => a.position - b.position)
            .map((field) => {
              const value = lead.custom[field.key];
              return {
                key: field.key,
                label: field.label,
                value:
                  field.options?.find((option) => option.value === value)
                    ?.label ?? String(value),
              };
            });
          return {
            lead,
            hotMin,
            fields,
            followUps,
            events: page.events,
            duplicates: [],
            history: refs,
            nextEventCursor: page.nextCursor,
            suggestionEventId,
          };
        });
      },
      async listLeadEvents(
        actor: Ctx,
        raw: LeadEventsQuery,
      ): Promise<LeadTimelinePage> {
        const parsed = leadEventsQuerySchema.safeParse(raw);
        if (!parsed.success)
          throw new AppError("validation", "This page of history is not valid");
        const { leadId } = parsed.data;
        return deps.context.withContext(actor, async (tx, current) => {
          await access.visibleLead(tx, current, leadId, "leads.view");
          const after = parsed.data.cursor
            ? cursor.decode(parsed.data.cursor, leadId, invalidPage)
            : null;
          const page = await detail._events(tx, leadId, after);
          const followUps = await detail._followUps(
            tx,
            current.companyId,
            leadId,
            page.events,
          );
          return {
            events: page.events,
            followUps,
            history: await history.references(
              deps,
              tx,
              null,
              page.events,
              followUps,
            ),
            nextCursor: page.nextCursor,
          };
        });
      },
    };
  },

  async _events(
    tx: TenantTx,
    leadId: string,
    after: { at: Date; id: string } | null,
  ): Promise<{ events: LeadEvent[]; nextCursor: string | null }> {
    const rows = await repository.listEvents(tx, leadId, after, pageSize + 1);
    const events = rows.slice(0, pageSize);
    const last = events.at(-1);
    return {
      events,
      nextCursor:
        rows.length > pageSize && last
          ? cursor.encode({ at: last.createdAt, id: last.id }, leadId)
          : null,
    };
  },

  async _followUps(
    tx: TenantTx,
    companyId: string,
    leadId: string,
    events: LeadEvent[],
  ) {
    const ids = events.flatMap((event) =>
      event.type === "follow_up_logged" &&
      typeof event.data.followUpId === "string"
        ? [event.data.followUpId]
        : [],
    );
    return readFollowUpsForEvents(tx, companyId, leadId, ids);
  },
};
export type LeadDetailService = ReturnType<typeof detail.create>;
export default detail;
