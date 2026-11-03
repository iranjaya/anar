import "server-only";
import { slugSchema } from "@anar/domain/agencies";
import {
  type DismissLostSuggestionInput,
  dismissLostSuggestionInputSchema,
  updateLeadFieldsResultWireSchema,
} from "@anar/domain/leads";
import { apiRequest } from "@/lib/api/client";
import { authEnabled } from "@/lib/api/mode";
import { AppError } from "@/lib/errors";

export async function dismissLostSuggestionReal(
  slug: string,
  input: DismissLostSuggestionInput,
): Promise<{ ok: true }> {
  if (!authEnabled())
    throw new AppError("unavailable", "Keeping this lead is not available.");
  const company = slugSchema.safeParse(slug);
  if (!company.success) throw new AppError("not_found", "Company not found.");
  const parsed = dismissLostSuggestionInputSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Choose the current suggestion.");
  await apiRequest(
    {
      path: `/api/companies/${company.data}/leads/dismissLostSuggestion`,
      method: "POST",
      body: parsed.data,
    },
    updateLeadFieldsResultWireSchema,
  );
  return { ok: true };
}
