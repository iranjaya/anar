"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, actionFailure } from "@/lib/errors";
import { getMyToday } from "@/modules/leads/server";
import { requireContext } from "@/modules/tenant/server";
import { logFollowUp } from "./server";

const inputSchema = z.object({
  slug: z.string().min(1),
  leadId: z.string().min(1),
  outcomeId: z.string().min(1),
  notes: z.string().optional(),
  nextActionAt: z.date().nullable().optional(),
  stageId: z.string().min(1).optional(),
  lostReasonId: z.string().min(1).optional(),
});

export async function logFollowUpAction(
  input: z.infer<typeof inputSchema>,
): Promise<
  ActionResult<
    Awaited<ReturnType<typeof logFollowUp>> & { nextLeadId: string | null }
  >
> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: "validation",
      message: "Pick an outcome and a valid follow-up date.",
    };
  try {
    const ctx = await requireContext(parsed.data.slug);
    const today = ctx.member ? await getMyToday(ctx) : null;
    const bucket =
      today &&
      [today.overdue, today.dueToday, today.newLeads].find((rows) =>
        rows.some((lead) => lead.id === parsed.data.leadId),
      );
    const data = await logFollowUp(ctx, parsed.data);
    const nextLeadId =
      bucket?.find((lead) => lead.id !== parsed.data.leadId)?.id ?? null;
    revalidatePath(`/${parsed.data.slug}`, "layout");
    return { ok: true, data: { ...data, nextLeadId } };
  } catch (error) {
    return actionFailure(error);
  }
}
