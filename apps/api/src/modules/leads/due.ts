import type { TenantTx } from "@anar/db/tenant";
import { sql } from "drizzle-orm";
import buckets, { type BucketCounts } from "./buckets.js";

export type DueFollowUp = {
  leadId: string;
  memberId: string;
  userId: string;
  nextActionAt: Date;
};

// Internal readers for the overdue and summary jobs; no route calls these.
const due = {
  // Every lead overdue at `at` in the scoped company, paged by lead ID.
  async listDueFollowUps(
    tx: TenantTx,
    input: { at: Date; afterLeadId?: string; limit: 100 },
  ): Promise<{ items: DueFollowUp[]; nextId: string | null }> {
    const after = input.afterLeadId
      ? sql`AND l.id > ${input.afterLeadId}::uuid`
      : sql``;
    const { rows } = await tx.execute<{
      lead_id: string;
      member_id: string;
      user_id: string;
      next_action_at: Date;
    }>(sql`SELECT l.id AS lead_id, m.id AS member_id, m.user_id, l.next_action_at
      FROM leads l
      JOIN stages s ON s.company_id = l.company_id AND s.id = l.stage_id AND s.kind = 'open'
      JOIN company_members m ON m.company_id = l.company_id AND m.id = l.assigned_to
        AND m.status = 'active'
      WHERE l.next_action_at < ${input.at} AND l.merged_into_id IS NULL
        AND l.deleted_at IS NULL ${after}
      ORDER BY l.id LIMIT ${input.limit + 1}`);
    const items = rows.slice(0, input.limit).map((row) => ({
      leadId: row.lead_id,
      memberId: row.member_id,
      userId: row.user_id,
      nextActionAt: new Date(row.next_action_at),
    }));
    return {
      items,
      nextId: rows.length > input.limit ? (items.at(-1)?.leadId ?? null) : null,
    };
  },

  readDailyCounts(
    tx: TenantTx,
    input: { memberId: string; at: Date; timezone: string },
  ): Promise<BucketCounts> {
    return buckets.counts(
      tx,
      input.memberId,
      buckets.day(input.at, input.timezone),
    );
  },
};
export default due;
