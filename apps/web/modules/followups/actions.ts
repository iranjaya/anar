"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, actionFailure } from "@/lib/errors";
import { requireFeatureContext } from "@/modules/tenant/server";
import { logFollowUp } from "./server";

const inputSchema = z.object({
  slug: z.string().min(1),
  requestId: z.uuid(),
  leadId: z.string().min(1),
  outcomeId: z.string().min(1),
  notes: z.string().max(2000).optional(),
  nextActionAt: z.date().nullable().optional(),
  stageId: z.string().min(1).optional(),
  lostReasonId: z.string().min(1).optional(),
});

export async function logFollowUpAction(
  input: z.infer<typeof inputSchema>,
): Promise<ActionResult<Awaited<ReturnType<typeof logFollowUp>>>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: "validation",
      message: "Pick an outcome and a valid follow-up date.",
    };
  try {
    const ctx = await requireFeatureContext(parsed.data.slug);
    const data = await logFollowUp(ctx, {
      requestId: parsed.data.requestId,
      leadId: parsed.data.leadId,
      outcomeId: parsed.data.outcomeId,
      notes: parsed.data.notes,
      nextActionAt: parsed.data.nextActionAt?.toISOString() ?? null,
      stageId: parsed.data.stageId,
      lostReasonId: parsed.data.lostReasonId,
    });
    revalidatePath(`/${parsed.data.slug}`, "layout");
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}
