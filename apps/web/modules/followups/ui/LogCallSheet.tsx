import type { LeadDetail, RealLeadDetail } from "@anar/domain/leads";
import { notFound } from "next/navigation";
import { type ActionResult, AppError } from "@/lib/errors";
import { getLead, getLeadDetail } from "@/modules/leads/server";
import { loadSchema } from "@/modules/settings/server";
import type { CompanySchema } from "@/modules/settings/types";
import {
  can,
  getCompanyShell,
  hasCapability,
  requireFeatureContext,
} from "@/modules/tenant/server";
import { LogCallForm } from "./LogCallForm";

export async function LogCallSheet({
  slug,
  leadId,
}: {
  slug: string;
  leadId: string;
}) {
  const view = await requireFeatureContext(slug);
  if ("capabilities" in view) {
    if (!hasCapability(view, "followups.log")) return null;
  } else if (view.role === "dna" || !view.member) return null;
  try {
    const [detail, schema]: [LeadDetail | RealLeadDetail, CompanySchema] =
      await Promise.all([
        "capabilities" in view
          ? getLeadDetail(slug, leadId).then(
              (result: ActionResult<RealLeadDetail> | null) => {
                if (!result)
                  throw new AppError("unavailable", "Couldn't load this lead.");
                if (!result.ok)
                  throw new AppError(result.error, result.message);
                return result.data;
              },
            )
          : getLead(view, leadId),
        loadSchema(view),
      ]);
    if (!("capabilities" in view) && !can(view, "followups.log", detail.lead))
      return null;
    const timezone =
      "capabilities" in view
        ? view.company.timezone
        : (await getCompanyShell(slug)).company.timezone;
    const currentStage =
      "capabilities" in view
        ? (detail as RealLeadDetail).history.stages.find(
            (stage) => stage.id === detail.lead.stageId,
          )
        : null;
    const choices =
      currentStage &&
      !schema.stages.some((stage) => stage.id === currentStage.id)
        ? { ...schema, stages: [currentStage, ...schema.stages] }
        : schema;
    return (
      <LogCallForm
        key={`${leadId}/${detail.lead.stageId}/${detail.lead.lostReasonId ?? ""}`}
        lead={detail.lead}
        schema={choices}
        admin={view.role === "admin"}
        timezone={timezone}
      />
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
}
