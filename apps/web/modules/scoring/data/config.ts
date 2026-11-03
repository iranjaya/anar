import "server-only";
import { slugSchema } from "@anar/domain/agencies";
import { type ScoringConfig, scoringConfigSchema } from "@anar/domain/scoring";
import { apiRequest } from "@/lib/api/client";
import { authEnabled } from "@/lib/api/mode";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";

export async function getScoringDefaults(
  slug: string,
): Promise<ActionResult<ScoringConfig> | null> {
  if (!authEnabled()) return null;
  try {
    const parsed = slugSchema.safeParse(slug);
    if (!parsed.success) throw new AppError("not_found", "Company not found.");
    const data = await apiRequest(
      { path: `/api/companies/${parsed.data}/scoring/getScoringDefaults` },
      scoringConfigSchema,
    );
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}
