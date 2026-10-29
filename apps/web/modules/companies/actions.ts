"use server";

import type { InviteResult } from "@anar/domain/auth";
import type { CreateCompanyResult } from "@anar/domain/companies";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";
import {
  createCompany,
  enterCompany,
  inviteSuperAdmin,
  leaveCompany,
  requestFreshCode,
  verifyFreshCode,
} from "./server";

export async function createCompanyAction(
  _previous: ActionResult<CreateCompanyResult> | null,
  form: FormData,
): Promise<ActionResult<CreateCompanyResult>> {
  try {
    const data = await createCompany({
      name: String(form.get("name") ?? ""),
      slug: String(form.get("slug") ?? ""),
      defaultCountry: "NP",
      timezone: "Asia/Kathmandu",
    });
    revalidatePath("/agency/companies");
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function inviteSuperAdminAction(
  companyId: string,
  _previous: ActionResult<InviteResult> | null,
  form: FormData,
): Promise<ActionResult<InviteResult>> {
  try {
    const data = await inviteSuperAdmin({
      companyId,
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
    });
    revalidatePath("/agency/companies");
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function companyFreshCodeAction(
  _previous: ActionResult<{ verified: boolean }> | null,
  form: FormData,
): Promise<ActionResult<{ verified: boolean }>> {
  try {
    const intent = form.get("intent");
    if (intent === "request") {
      await requestFreshCode();
      return { ok: true, data: { verified: false } };
    }
    if (intent !== "verify")
      throw new AppError("validation", "Choose a code action.");
    await verifyFreshCode(String(form.get("code") ?? ""));
    return { ok: true, data: { verified: true } };
  } catch (error) {
    return actionFailure(error);
  }
}

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
