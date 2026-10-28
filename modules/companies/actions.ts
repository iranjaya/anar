"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, actionFailure } from "@/lib/errors";
import { enterCompany, leaveCompany } from "./server";

export async function enterCompanyAction(input: {
  companyId: string;
}): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = z.object({ companyId: z.string().min(1) }).safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "validation", message: "Choose a company." };
  try {
    const result = await enterCompany(parsed.data.companyId);
    revalidatePath("/", "layout");
    return { ok: true, data: result };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function leaveCompanyAction(): Promise<
  ActionResult<{ redirectTo: string }>
> {
  try {
    const result = await leaveCompany();
    revalidatePath("/", "layout");
    return { ok: true, data: result };
  } catch (error) {
    return actionFailure(error);
  }
}
