import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { loadSchema } from "@/modules/settings/server";
import { can, verifyContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import type { LeadDetail } from "../types";

export async function readVisibleLead(ctx: Ctx, leadId: string) {
  const current = await verifyContext(ctx);
  const data = await store();
  const lead = data.leads.find(
    (lead) =>
      lead.companyId === current.companyId &&
      lead.id === leadId &&
      lead.deletedAt === null &&
      lead.mergedIntoId === null,
  );
  if (!lead || !can(current, "leads.view", lead))
    throw new AppError("not_found", "Lead not found.");
  return { current, data, lead };
}

export async function getLead(ctx: Ctx, leadId: string): Promise<LeadDetail> {
  const { current, data, lead } = await readVisibleLead(ctx, leadId);
  const schema = await loadSchema(current);
  if (!can(current, "leads.view", lead))
    throw new AppError("not_found", "Lead not found.");
  const config = data.scoringConfigs.find(
    (config) => config.companyId === current.companyId && config.active,
  );
  if (!config || !schema.stages.some((stage) => stage.id === lead.stageId))
    throw new AppError("unavailable", "Couldn't load this lead's settings.");
  return {
    lead: structuredClone(lead),
    hotMin: config.hotMin,
    fields: schema.fields
      .slice()
      .sort((a, b) => a.position - b.position)
      .flatMap((field) => {
        const value = lead.custom[field.key];
        if (value === null || value === undefined || value === "") return [];
        const label =
          field.options?.find((option) => option.value === value)?.label ??
          String(value);
        return [{ key: field.key, label: field.label, value: label }];
      }),
    followUps: data.followUps
      .filter(
        (call) =>
          call.companyId === current.companyId && call.leadId === leadId,
      )
      .sort((a, b) => b.happenedAt.getTime() - a.happenedAt.getTime()),
    events: data.events
      .filter(
        (event) =>
          event.companyId === current.companyId && event.leadId === leadId,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    duplicates: [],
  };
}
