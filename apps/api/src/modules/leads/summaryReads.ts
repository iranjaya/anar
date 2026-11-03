import { readCompanyScope, type TenantTx } from "@anar/db/tenant";
import { sql } from "drizzle-orm";
import { readWeeklyCallCounts } from "../followups/index.js";
import due from "./due.js";

export type WeeklyCounts = {
  leads: number;
  calls: number;
  siteVisits: number;
  bookings: number;
  overdue: number;
  staffCalls: number;
  byAdmin: {
    memberId: string;
    userId: string;
    name: string;
    calls: number;
  }[];
};
type WeeklyCallCounts = Pick<
  WeeklyCounts,
  "calls" | "siteVisits" | "staffCalls"
> & { byMember: { memberId: string; calls: number }[] };

const summaryReads = {
  readDailyCounts: due.readDailyCounts,

  async readWeeklyCounts(
    tx: TenantTx,
    input: { from: Date; to: Date; at: Date },
  ): Promise<WeeklyCounts> {
    const { companyId } = await readCompanyScope(tx);
    const calls: WeeklyCallCounts = await readWeeklyCallCounts(tx, {
      from: input.from,
      to: input.to,
    });
    const { rows: totals } = await tx.execute<{
      leads: number;
      bookings: number;
      overdue: number;
    }>(sql`SELECT
      (SELECT count(*)::int FROM leads l
        WHERE l.company_id = ${companyId}
          AND l.created_at >= ${input.from} AND l.created_at < ${input.to}) AS leads,
      (SELECT count(*)::int FROM lead_events e
        WHERE e.company_id = ${companyId} AND e.type = 'stage_changed'
          AND e.created_at >= ${input.from} AND e.created_at < ${input.to}
          AND e.data->>'toKind' = 'won'
          AND e.data->>'fromKind' <> 'won') AS bookings,
      (SELECT count(*)::int FROM leads l
        JOIN stages s ON s.company_id = l.company_id AND s.id = l.stage_id
          AND s.kind = 'open'
        JOIN company_members m ON m.company_id = l.company_id
          AND m.id = l.assigned_to AND m.status = 'active'
        WHERE l.company_id = ${companyId} AND l.deleted_at IS NULL
          AND l.merged_into_id IS NULL AND l.next_action_at < ${input.at}) AS overdue`);
    const { rows: admins } = await tx.execute<{
      member_id: string;
      user_id: string;
      name: string;
      has_work: boolean;
    }>(sql`SELECT m.id AS member_id, m.user_id, m.name,
        EXISTS (SELECT 1 FROM leads l
          WHERE l.company_id = m.company_id AND l.assigned_to = m.id
            AND l.deleted_at IS NULL AND l.merged_into_id IS NULL) AS has_work
      FROM company_members m WHERE m.company_id = ${companyId}
        AND m.role = 'admin' AND m.status = 'active'
      ORDER BY m.id`);
    const byMember = new Map<string, number>(
      calls.byMember.map((item) => [item.memberId, item.calls]),
    );
    const byAdmin = admins
      .filter((member) => member.has_work || byMember.has(member.member_id))
      .map((member) => ({
        memberId: member.member_id,
        userId: member.user_id,
        name: member.name,
        calls: byMember.get(member.member_id) ?? 0,
      }));
    const [total] = totals;
    if (!total) throw new Error("Weekly counts are missing");
    return {
      leads: total.leads,
      calls: calls.calls,
      siteVisits: calls.siteVisits,
      bookings: total.bookings,
      overdue: total.overdue,
      staffCalls: calls.staffCalls,
      byAdmin,
    };
  },
};
export default summaryReads;
