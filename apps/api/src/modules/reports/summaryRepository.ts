import {
  companyJobPeriods,
  readCompanyScope,
  type TenantTx,
} from "@anar/db/tenant";
import { and, eq, sql } from "drizzle-orm";
import { v7 } from "uuid";

export type SummaryKind = "daily" | "weekly";
type PeriodInput = {
  kind: SummaryKind;
  key: string;
  at: Date;
  timezone: string;
  snapshot(): Promise<Record<string, unknown>>;
};

const name = (kind: SummaryKind) => `summary.${kind}`;
const summaryRepository = {
  async openPeriod(tx: TenantTx, input: PeriodInput) {
    const scope = await readCompanyScope(tx);
    const where = and(
      eq(companyJobPeriods.companyId, scope.companyId),
      eq(companyJobPeriods.jobName, name(input.kind)),
      eq(companyJobPeriods.periodKey, input.key),
    );
    let [period] = await tx
      .select()
      .from(companyJobPeriods)
      .where(where)
      .for("update");
    if (!period) {
      await tx
        .insert(companyJobPeriods)
        .values({
          id: v7(),
          companyId: scope.companyId,
          jobName: name(input.kind),
          periodKey: input.key,
          scheduledAt: input.at,
          timezone: input.timezone,
          status: "running",
          snapshot: await input.snapshot(),
        })
        .onConflictDoNothing({
          target: [
            companyJobPeriods.companyId,
            companyJobPeriods.jobName,
            companyJobPeriods.periodKey,
          ],
        });
      [period] = await tx
        .select()
        .from(companyJobPeriods)
        .where(where)
        .for("update");
    }
    if (!period || period.status === "done") return null;
    return {
      at: period.scheduledAt,
      timezone: period.timezone,
      cursor: period.cursor,
      snapshot: period.snapshot,
    };
  },

  async checkpoint(
    tx: TenantTx,
    input: {
      kind: SummaryKind;
      key: string;
      cursor: string | null;
      done: boolean;
    },
  ): Promise<void> {
    const scope = await readCompanyScope(tx);
    await tx
      .update(companyJobPeriods)
      .set({
        cursor: input.cursor,
        status: input.done ? "done" : "running",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(companyJobPeriods.companyId, scope.companyId),
          eq(companyJobPeriods.jobName, name(input.kind)),
          eq(companyJobPeriods.periodKey, input.key),
        ),
      );
  },

  async listDailyAdmins(
    tx: TenantTx,
    input: { afterMemberId?: string; limit: 100 },
  ): Promise<{
    items: { memberId: string; userId: string }[];
    nextId: string | null;
  }> {
    const scope = await readCompanyScope(tx);
    const after = input.afterMemberId
      ? sql`AND m.id > ${input.afterMemberId}::uuid`
      : sql``;
    const { rows } = await tx.execute<{
      member_id: string;
      user_id: string;
    }>(sql`SELECT m.id AS member_id, m.user_id
      FROM company_members m WHERE m.company_id = ${scope.companyId}
        AND m.role = 'admin' AND m.status = 'active' ${after}
        AND EXISTS (SELECT 1 FROM leads l
          WHERE l.company_id = m.company_id AND l.assigned_to = m.id
            AND l.deleted_at IS NULL AND l.merged_into_id IS NULL)
      ORDER BY m.id LIMIT ${input.limit + 1}`);
    const items = rows.slice(0, input.limit).map((row) => ({
      memberId: row.member_id,
      userId: row.user_id,
    }));
    return {
      items,
      nextId:
        rows.length > input.limit ? (items.at(-1)?.memberId ?? null) : null,
    };
  },

  async listWeeklyManagers(
    tx: TenantTx,
    input: { afterMemberId?: string; limit: 100 },
  ): Promise<{
    items: { memberId: string; userId: string }[];
    nextId: string | null;
  }> {
    const scope = await readCompanyScope(tx);
    const after = input.afterMemberId
      ? sql`AND id > ${input.afterMemberId}::uuid`
      : sql``;
    const { rows } = await tx.execute<{
      member_id: string;
      user_id: string;
    }>(sql`SELECT id AS member_id, user_id FROM company_members
      WHERE company_id = ${scope.companyId} AND role = 'super_admin'
        AND status = 'active' ${after}
      ORDER BY id LIMIT ${input.limit + 1}`);
    const items = rows.slice(0, input.limit).map((row) => ({
      memberId: row.member_id,
      userId: row.user_id,
    }));
    return {
      items,
      nextId:
        rows.length > input.limit ? (items.at(-1)?.memberId ?? null) : null,
    };
  },

  async isActiveManager(tx: TenantTx, userId: string): Promise<boolean> {
    const scope = await readCompanyScope(tx);
    const { rows } = await tx.execute<{ id: string }>(sql`SELECT id
      FROM company_members WHERE company_id = ${scope.companyId}
        AND user_id = ${userId} AND role = 'super_admin'
        AND status = 'active' LIMIT 1`);
    return rows.length === 1;
  },

  async isActiveAdmin(tx: TenantTx, userId: string): Promise<boolean> {
    const scope = await readCompanyScope(tx);
    const { rows } = await tx.execute<{ id: string }>(sql`SELECT id
      FROM company_members WHERE company_id = ${scope.companyId}
        AND user_id = ${userId} AND role = 'admin'
        AND status = 'active' LIMIT 1`);
    return rows.length === 1;
  },
};
export default summaryRepository;
