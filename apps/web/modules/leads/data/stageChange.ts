import "server-only";
import { slugSchema } from "@anar/domain/agencies";
import {
  type ChangeStageInput,
  changeStageInputSchema,
  updateLeadFieldsResultWireSchema,
} from "@anar/domain/leads";
import { apiRequest } from "@/lib/api/client";
import { authEnabled } from "@/lib/api/mode";
import { AppError } from "@/lib/errors";

export async function changeStage(slug: string, input: ChangeStageInput) {
  if (!authEnabled())
    throw new AppError("unavailable", "Changing stages is not available yet.");
  const company = slugSchema.safeParse(slug);
  if (!company.success) throw new AppError("not_found", "Company not found.");
  const parsed = changeStageInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("validation", "Choose a stage.");
  await apiRequest(
    {
      path: `/api/companies/${company.data}/leads/changeStage`,
      method: "POST",
      body: parsed.data,
    },
    updateLeadFieldsResultWireSchema,
  );
  return { ok: true as const };
}
