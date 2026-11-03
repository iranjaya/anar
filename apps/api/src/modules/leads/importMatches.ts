import { leads, readCompanyScope, type TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type FindImportMatchesInput,
  findImportMatchesInputSchema,
  type ImportMatch,
} from "@anar/domain/leads";
import { and, inArray, isNull, sql } from "drizzle-orm";

const importMatches = {
  // The live phone index keeps one live lead per phone, so each phone matches once.
  async findImportMatches(
    tx: TenantTx,
    raw: FindImportMatchesInput,
  ): Promise<ImportMatch[]> {
    const parsed = findImportMatchesInputSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("validation", "Phone lookup is not valid");
    await readCompanyScope(tx);
    const { phones } = parsed.data;
    if (phones.length === 0) return [];
    return tx
      .select({
        leadId: leads.id,
        phoneE164: sql<string>`${leads.phoneE164}`,
        campaignName: leads.campaignName,
        leadDate: leads.leadDate,
      })
      .from(leads)
      .where(
        and(
          inArray(leads.phoneE164, phones),
          isNull(leads.mergedIntoId),
          isNull(leads.deletedAt),
        ),
      );
  },
};
export default importMatches;
