"use server";

import type { InviteResult } from "@anar/domain/auth";
import type { CreateCompanyResult } from "@anar/domain/companies";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, actionFailure } from "@/lib/errors";
import {
  createCompany,
  enterAgencyCompany,
  enterCompany,
  inviteSuperAdmin,
  leaveAgencyCompany,
  leaveCompany,
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

export async function enterAgencyCompanyAction(
  target: { companyId: string; slug: string },
  _previous: ActionResult<{ ok: true }> | null,
  form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  try {
    await enterAgencyCompany({
      companyId: target.companyId,
      reason: String(form.get("reason") ?? ""),
    });
  } catch (error) {
    return actionFailure(error);
  }
  redirect(`/${target.slug}`);
}

export async function leaveAgencyCompanyAction(
  _previous: ActionResult<{ ok: true }> | null,
  _form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  try {
    await leaveAgencyCompany();
  } catch (error) {
    return actionFailure(error);
  }
  redirect("/agency/companies");
}
