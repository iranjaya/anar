import { slugSchema } from "@anar/domain/agencies";
import {
  type AssignLeadsInput,
  assignLeadsResultSchema,
} from "@anar/domain/assignment";
import { AppError } from "@anar/domain/errors";
import { apiSuccessSchema } from "@anar/domain/http";
import {
  type ChangeStageInput,
  type DismissLostSuggestionInput,
  type FollowUp,
  type Lead,
  type LeadEvent,
  type LeadEventsQuery,
  type LeadFilters,
  leadDetailWireSchema,
  leadPageWireSchema,
  leadTimelinePageWireSchema,
  type UpdateLeadFieldsInput,
  updateLeadFieldsResultWireSchema,
} from "@anar/domain/leads";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Ctx } from "../tenant/index.js";
import type { LeadAssignService } from "./assign.js";
import type { LeadDetailService } from "./detail.js";
import type { LeadListService } from "./list.js";
import type { LeadStageService } from "./stage.js";
import type { LeadSuggestionService } from "./suggestion.js";
import type { LeadUpdateService } from "./update.js";

export type LeadRouteOptions = { leads: LeadListService };
export type LeadDetailRouteOptions = { leadDetail: LeadDetailService };
export type LeadAssignRouteOptions = {
  leadAssign: LeadAssignService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};
export type LeadStageRouteOptions = {
  leadStage: LeadStageService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};
export type LeadSuggestionRouteOptions = {
  leadSuggestion: LeadSuggestionService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};
export type LeadUpdateRouteOptions = {
  leadUpdate: LeadUpdateService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};
type SlugRequest = FastifyRequest<{ Params: { slug: string } }>;
const iso = (date: Date | null) => date?.toISOString() ?? null;

const routes = {
  async register(
    app: FastifyInstance,
    { leads }: LeadRouteOptions,
  ): Promise<void> {
    const page = apiSuccessSchema(leadPageWireSchema);
    app.get<{ Params: { slug: string }; Querystring: LeadFilters }>(
      "/api/companies/:slug/leads/listLeads",
      async (request, reply) => {
        const actor = await routes._context(leads, request);
        const result = await leads.listLeads(actor, request.query);
        return reply.send(
          page.parse({
            ok: true,
            data: {
              ...result,
              items: result.items.map((item) => ({
                ...item,
                nextActionAt: iso(item.nextActionAt),
                leadDate: item.leadDate.toISOString(),
                assignedAt: iso(item.assignedAt),
              })),
            },
          }),
        );
      },
    );
  },

  async registerDetail(
    app: FastifyInstance,
    { leadDetail }: LeadDetailRouteOptions,
  ): Promise<void> {
    const detail = apiSuccessSchema(leadDetailWireSchema);
    const timeline = apiSuccessSchema(leadTimelinePageWireSchema);
    app.get<{ Params: { slug: string }; Querystring: { leadId: string } }>(
      "/api/companies/:slug/leads/getLead",
      async (request, reply) => {
        const actor = await routes._context(leadDetail, request);
        const result = await leadDetail.getLead(actor, request.query);
        return reply.send(
          detail.parse({
            ok: true,
            data: {
              ...result,
              lead: routes._lead(result.lead),
              events: result.events.map(routes._event),
              followUps: result.followUps.map(routes._followUp),
              history: routes._history(result.history),
            },
          }),
        );
      },
    );
    app.get<{ Params: { slug: string }; Querystring: LeadEventsQuery }>(
      "/api/companies/:slug/leads/listLeadEvents",
      async (request, reply) => {
        const actor = await routes._context(leadDetail, request);
        const result = await leadDetail.listLeadEvents(actor, request.query);
        return reply.send(
          timeline.parse({
            ok: true,
            data: {
              ...result,
              events: result.events.map(routes._event),
              followUps: result.followUps.map(routes._followUp),
              history: routes._history(result.history),
            },
          }),
        );
      },
    );
  },

  async registerUpdate(
    app: FastifyInstance,
    { leadUpdate, requireOrigin }: LeadUpdateRouteOptions,
  ): Promise<void> {
    const updated = apiSuccessSchema(updateLeadFieldsResultWireSchema);
    app.post<{ Params: { slug: string }; Body: UpdateLeadFieldsInput }>(
      "/api/companies/:slug/leads/updateLeadFields",
      {
        onRequest: async (request) => {
          await requireOrigin(request);
        },
      },
      async (request, reply) => {
        const actor = await routes._context(leadUpdate, request);
        const result = await leadUpdate.updateLeadFields(actor, request.body, {
          ip: request.ip,
        });
        return reply.send(
          updated.parse({
            ok: true,
            data: { lead: routes._lead(result.lead) },
          }),
        );
      },
    );
  },

  async registerStage(
    app: FastifyInstance,
    { leadStage, requireOrigin }: LeadStageRouteOptions,
  ): Promise<void> {
    const changed = apiSuccessSchema(updateLeadFieldsResultWireSchema);
    app.post<{ Params: { slug: string }; Body: ChangeStageInput }>(
      "/api/companies/:slug/leads/changeStage",
      {
        onRequest: async (request) => {
          await requireOrigin(request);
        },
      },
      async (request, reply) => {
        const actor = await routes._context(leadStage, request);
        const result = await leadStage.changeStage(actor, request.body, {
          ip: request.ip,
        });
        return reply.send(
          changed.parse({
            ok: true,
            data: { lead: routes._lead(result.lead) },
          }),
        );
      },
    );
  },

  async registerSuggestion(
    app: FastifyInstance,
    { leadSuggestion, requireOrigin }: LeadSuggestionRouteOptions,
  ): Promise<void> {
    const dismissed = apiSuccessSchema(updateLeadFieldsResultWireSchema);
    app.post<{
      Params: { slug: string };
      Body: DismissLostSuggestionInput;
    }>(
      "/api/companies/:slug/leads/dismissLostSuggestion",
      {
        onRequest: async (request) => {
          await requireOrigin(request);
        },
      },
      async (request, reply) => {
        const actor = await routes._context(leadSuggestion, request);
        const result = await leadSuggestion.dismissLostSuggestion(
          actor,
          request.body,
          { ip: request.ip },
        );
        return reply.send(
          dismissed.parse({
            ok: true,
            data: { lead: routes._lead(result.lead) },
          }),
        );
      },
    );
  },

  async registerAssign(
    app: FastifyInstance,
    { leadAssign, requireOrigin }: LeadAssignRouteOptions,
  ): Promise<void> {
    const assigned = apiSuccessSchema(assignLeadsResultSchema);
    app.post<{ Params: { slug: string }; Body: AssignLeadsInput }>(
      "/api/companies/:slug/leads/assignLeads",
      {
        onRequest: async (request) => {
          await requireOrigin(request);
        },
      },
      async (request, reply) => {
        const actor = await routes._context(leadAssign, request);
        const result = await leadAssign.assign(actor, request.body, {
          ip: request.ip,
        });
        return reply.send(assigned.parse({ ok: true, data: result }));
      },
    );
  },

  async _context(
    service: {
      requireContext(request: SlugRequest, slug: string): Promise<Ctx>;
    },
    request: SlugRequest,
  ): Promise<Ctx> {
    const slug = slugSchema.safeParse(request.params.slug);
    if (!slug.success)
      throw new AppError("validation", "A valid company slug is required");
    return service.requireContext(request, slug.data);
  },

  _lead(lead: Lead) {
    return {
      ...lead,
      leadDate: lead.leadDate.toISOString(),
      scoredAt: lead.scoredAt.toISOString(),
      nextActionAt: iso(lead.nextActionAt),
      lastContactedAt: iso(lead.lastContactedAt),
      lostSuggestedAt: iso(lead.lostSuggestedAt),
      deletedAt: iso(lead.deletedAt),
      createdAt: lead.createdAt.toISOString(),
    };
  },

  _event(event: LeadEvent) {
    return { ...event, createdAt: event.createdAt.toISOString() };
  },

  _followUp(call: FollowUp) {
    return {
      ...call,
      happenedAt: call.happenedAt.toISOString(),
      nextActionAt: iso(call.nextActionAt),
    };
  },

  _history<T extends { fields: { archivedAt: Date | null }[] }>(refs: T) {
    return {
      ...refs,
      fields: refs.fields.map((field) => ({
        ...field,
        archivedAt: iso(field.archivedAt),
      })),
    };
  },
};
export default routes;
