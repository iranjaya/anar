import { companyMembers, type TenantTx } from "@anar/db/tenant";
import { and, count, eq } from "drizzle-orm";

const repository = {
  async hasMembership(tx: TenantTx, userId: string): Promise<boolean> {
    const rows = await tx
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(eq(companyMembers.userId, userId))
      .limit(1);
    return rows.length > 0;
  },
  async insert(tx: TenantTx, input: typeof companyMembers.$inferInsert) {
    const [member] = await tx
      .insert(companyMembers)
      .values(input)
      .onConflictDoNothing({
        target: [companyMembers.companyId, companyMembers.userId],
      })
      .returning();
    return member;
  },
  async readActive(tx: TenantTx, companyId: string, memberId: string) {
    const [member] = await tx
      .select()
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.id, memberId),
          eq(companyMembers.status, "active"),
        ),
      );
    return member;
  },
  async countActive(tx: TenantTx, companyId: string): Promise<number> {
    const [row] = await tx
      .select({ count: count() })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.status, "active"),
        ),
      );
    return row.count;
  },
};
export default repository;
