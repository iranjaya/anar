import "server-only";
import { slugSchema } from "@anar/domain/agencies";
import {
  type LeadFilters,
  type LeadPage,
  leadFiltersSchema,
  leadPageWireSchema,
  leadRowWireSchema,
} from "@anar/domain/leads";
import { apiDateSchema, apiRequest } from "@/lib/api/client";
import { authEnabled } from "@/lib/api/mode";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";

export const leadPageSchema = leadPageWireSchema.extend({
  items: leadRowWireSchema
    .extend({
      nextActionAt: apiDateSchema.nullable(),
      leadDate: apiDateSchema,
      assignedAt: apiDateSchema.nullable(),
    })
    .array(),
});

export async function listLeadQueue(
  slug: string,
  filters: LeadFilters,
): Promise<ActionResult<LeadPage> | null> {
  if (!authEnabled()) return null;
  try {
    const company = slugSchema.safeParse(slug);
    if (!company.success) throw new AppError("not_found", "Company not found.");
    const query = leadFiltersSchema.safeParse(filters);
    if (!query.success)
      throw new AppError("validation", "This search is not valid.");
    const data = await apiRequest(
      {
        path: `/api/companies/${company.data}/leads/listLeads`,
        query: Object.fromEntries(
          Object.entries(query.data).filter(
            (entry): entry is [string, string] => Boolean(entry[1]),
          ),
        ),
      },
      leadPageSchema,
    );
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}
