import "server-only";
import { slugSchema } from "@anar/domain/agencies";
import {
  followUpWireSchema,
  historyReferencesWireSchema,
  type LeadTimelinePage,
  leadDetailWireSchema,
  leadEventsQuerySchema,
  leadEventWireSchema,
  leadIdQuerySchema,
  leadTimelinePageWireSchema,
  leadWireSchema,
  type RealLeadDetail,
} from "@anar/domain/leads";
import { apiDateSchema, apiRequest } from "@/lib/api/client";
import { authEnabled } from "@/lib/api/mode";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";

const date = apiDateSchema;
const event = leadEventWireSchema.extend({ createdAt: date });
const followUp = followUpWireSchema.extend({
  happenedAt: date,
  nextActionAt: date.nullable(),
});
const history = historyReferencesWireSchema.extend({
  fields: historyReferencesWireSchema.shape.fields.element
    .extend({ archivedAt: date.nullable() })
    .array(),
});
export const leadDetailSchema = leadDetailWireSchema.extend({
  lead: leadWireSchema.extend({
    leadDate: date,
    scoredAt: date,
    nextActionAt: date.nullable(),
    lastContactedAt: date.nullable(),
    lostSuggestedAt: date.nullable(),
    deletedAt: date.nullable(),
    createdAt: date,
  }),
  events: event.array(),
  followUps: followUp.array(),
  history,
});
export const leadTimelinePageSchema = leadTimelinePageWireSchema.extend({
  events: event.array(),
  followUps: followUp.array(),
  history,
});

export async function getLeadDetail(
  slug: string,
  leadId: string,
): Promise<ActionResult<RealLeadDetail> | null> {
  if (!authEnabled()) return null;
  try {
    const company = slugSchema.safeParse(slug);
    const query = leadIdQuerySchema.safeParse({ leadId });
    if (!company.success || !query.success)
      throw new AppError("not_found", "Lead not found.");
    const data = await apiRequest(
      {
        path: `/api/companies/${company.data}/leads/getLead`,
        query: query.data,
      },
      leadDetailSchema,
    );
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function listLeadEvents(
  slug: string,
  leadId: string,
  cursor: string,
): Promise<ActionResult<LeadTimelinePage> | null> {
  if (!authEnabled()) return null;
  try {
    const company = slugSchema.safeParse(slug);
    const query = leadEventsQuerySchema.safeParse({ leadId, cursor });
    if (!company.success || !query.success)
      throw new AppError("validation", "This page of history is not valid.");
    const data = await apiRequest(
      {
        path: `/api/companies/${company.data}/leads/listLeadEvents`,
        query: { leadId: query.data.leadId, cursor },
      },
      leadTimelinePageSchema,
    );
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}
