import "server-only";
import { slugSchema } from "@anar/domain/agencies";
import {
  type AssignLeadsInput,
  assignLeadsInputSchema,
  assignLeadsResultSchema,
} from "@anar/domain/assignment";
import { apiRequest } from "@/lib/api/client";
import { authEnabled } from "@/lib/api/mode";
import { AppError } from "@/lib/errors";

export async function assignLeads(slug: string, input: AssignLeadsInput) {
  if (!authEnabled())
    throw new AppError("unavailable", "Assigning leads is not available yet.");
  const company = slugSchema.safeParse(slug);
  if (!company.success) throw new AppError("not_found", "Company not found.");
  const parsed = assignLeadsInputSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Choose up to 500 leads and a person.");
  return apiRequest(
    {
      path: `/api/companies/${company.data}/leads/assignLeads`,
      method: "POST",
      body: parsed.data,
    },
    assignLeadsResultSchema,
  );
}
