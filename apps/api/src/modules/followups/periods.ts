import {
  companyJobPeriods,
  notifications,
  readCompanyScope,
  type TenantTx,
} from "@anar/db/tenant";
import { and, eq } from "drizzle-orm";
import { v7 } from "uuid";

const jobName = "followups.overdue_scan";
const periods = {
  async openPeriod(
    tx: TenantTx,
    input: { slot: string; at: Date; timezone: string; localDate: string },
  ) {
    const scope = await readCompanyScope(tx);
    await tx
      .insert(companyJobPeriods)
      .values({
        id: v7(),
        companyId: scope.companyId,
        jobName,
        periodKey: input.slot,
        scheduledAt: input.at,
        timezone: input.timezone,
        status: "running",
        snapshot: { localDate: input.localDate },
      })
      .onConflictDoNothing({
        target: [
          companyJobPeriods.companyId,
          companyJobPeriods.jobName,
          companyJobPeriods.periodKey,
        ],
      });
    const [row] = await tx
      .select()
      .from(companyJobPeriods)
      .where(
        and(
          eq(companyJobPeriods.companyId, scope.companyId),
          eq(companyJobPeriods.jobName, jobName),
          eq(companyJobPeriods.periodKey, input.slot),
        ),
      )
      .for("update");
    if (!row || row.status === "done") return null;
    return {
      at: row.scheduledAt,
      timezone: row.timezone,
      localDate: String(row.snapshot?.localDate),
      cursor: row.cursor,
    };
  },
  async checkpointPeriod(
    tx: TenantTx,
    input: { slot: string; cursor: string | null; done: boolean },
  ): Promise<void> {
    await tx
      .update(companyJobPeriods)
      .set({
        cursor: input.cursor,
        status: input.done ? "done" : "running",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(companyJobPeriods.jobName, jobName),
          eq(companyJobPeriods.periodKey, input.slot),
        ),
      );
  },
  async hasNotification(
    tx: TenantTx,
    userId: string,
    dedupeKey: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.dedupeKey, dedupeKey),
        ),
      );
    return Boolean(row);
  },
};
export default periods;
