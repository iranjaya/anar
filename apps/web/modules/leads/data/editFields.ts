import "server-only";
import { slugSchema } from "@anar/domain/agencies";
import {
  type UpdateLeadFieldsInput,
  updateLeadFieldsInputSchema,
  updateLeadFieldsResultWireSchema,
} from "@anar/domain/leads";
import { apiRequest } from "@/lib/api/client";
import { authEnabled } from "@/lib/api/mode";
import { AppError } from "@/lib/errors";

export async function updateLeadFields(
  slug: string,
  input: UpdateLeadFieldsInput,
) {
  if (!authEnabled())
    throw new AppError("unavailable", "Editing leads is not available yet.");
  const company = slugSchema.safeParse(slug);
  if (!company.success) throw new AppError("not_found", "Company not found.");
  const parsed = updateLeadFieldsInputSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      "validation",
      parsed.error.issues[0]?.message ?? "These changes are not valid.",
    );
  await apiRequest(
    {
      path: `/api/companies/${company.data}/leads/updateLeadFields`,
      method: "POST",
      body: parsed.data,
    },
    updateLeadFieldsResultWireSchema,
  );
  return { ok: true as const };
}
