import {
  leads,
  readCompanyScope,
  stages,
  type TenantTx,
} from "@anar/db/tenant";
import type {
  MemberLeadCounts,
  ReferenceCounts,
  ReferenceInput,
} from "@anar/domain/leads";
import { and, count, eq, isNull, type SQL, sql } from "drizzle-orm";

const referenceCounts = {
  // Counts every kept lead, merged and deleted ones too, so history is never orphaned.
  async getReferenceCounts(
    tx: TenantTx,
    input: ReferenceInput,
  ): Promise<ReferenceCounts> {
    await readCompanyScope(tx);
    const used =
      input.kind === "field"
        ? sql`${leads.custom} -> ${input.fieldKey}::text <> 'null'::jsonb`
        : eq(leads.stageId, input.stageId);
    const [row] = await tx
      .select({ leadCount: count() })
      .from(leads)
      .where(used);
    return row;
  },
  async getMemberOpenLeadCount(
    tx: TenantTx,
    memberId: string,
  ): Promise<number> {
    const counts = await referenceCounts.getMemberLeadCounts(
      tx,
      memberId,
      new Date(),
    );
    return counts.openLeads;
  },
  async getMemberLeadCounts(
    tx: TenantTx,
    memberId: string,
    at: Date,
  ): Promise<MemberLeadCounts> {
    await readCompanyScope(tx);
    const overdue: SQL<number> = sql`count(*) filter (where ${leads.nextActionAt} < ${at})`;
    const [row] = await tx
      .select({ openLeads: count(), overdue: overdue.mapWith(Number) })
      .from(leads)
      .innerJoin(
        stages,
        and(
          eq(stages.companyId, leads.companyId),
          eq(stages.id, leads.stageId),
        ),
      )
      .where(
        and(
          eq(leads.assignedTo, memberId),
          isNull(leads.mergedIntoId),
          isNull(leads.deletedAt),
          eq(stages.kind, "open"),
        ),
      );
    return row;
  },
};
export default referenceCounts;
