import { notFound } from "next/navigation";
import { AppError } from "@/lib/errors";
import { getLead } from "@/modules/leads/server";
import { loadSchema } from "@/modules/settings/server";
import { requireDemoContext } from "@/modules/tenant/server";
import { LogCallForm } from "./LogCallForm";

export async function LogCallSheet({ leadId }: { leadId: string }) {
  const ctx = await requireDemoContext();
  if (ctx.role === "dna") return null;
  try {
    const [detail, schema] = await Promise.all([
      getLead(ctx, leadId),
      loadSchema(ctx),
    ]);
    return (
      <LogCallForm
        key={`${leadId}/${detail.lead.stageId}/${detail.lead.lostReasonId ?? ""}`}
        lead={detail.lead}
        schema={schema}
        role={ctx.role}
      />
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
}
