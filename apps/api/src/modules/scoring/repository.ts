import { scoringConfigs, type TenantTx } from "@anar/db/tenant";
import { and, eq } from "drizzle-orm";

const repository = {
  async readActive(tx: TenantTx, companyId: string) {
    const [row] = await tx
      .select()
      .from(scoringConfigs)
      .where(
        and(
          eq(scoringConfigs.companyId, companyId),
          eq(scoringConfigs.active, true),
        ),
      );
    return row;
  },
  async insert(tx: TenantTx, input: typeof scoringConfigs.$inferInsert) {
    const [row] = await tx
      .insert(scoringConfigs)
      .values(input)
      .onConflictDoNothing()
      .returning({ id: scoringConfigs.id });
    return row;
  },
};
export default repository;
