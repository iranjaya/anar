import { readCompanyScope, type TenantTx } from "@anar/db/tenant";
import type {
  LogFollowUpResult,
  LogFollowUpWireResult,
} from "@anar/domain/followups";
import { sql } from "drizzle-orm";

type Saved = {
  leadId: string;
  requestHash: string;
  response: unknown;
};

const repository = {
  async activeManagerUserIds(
    tx: TenantTx,
    companyId: string,
  ): Promise<string[]> {
    const { rows } = await tx.execute<{ user_id: string }>(sql`SELECT user_id
      FROM company_members WHERE company_id = ${companyId}
        AND role = 'super_admin' AND status = 'active'
      ORDER BY user_id`);
    return rows.map((row) => row.user_id);
  },

  async lockRequest(
    tx: TenantTx,
    companyId: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${`${companyId}:${userId}:${requestId}`}, 0)
    )`);
  },

  async findRequest(
    tx: TenantTx,
    companyId: string,
    userId: string,
    requestId: string,
  ): Promise<Saved | null> {
    const { rows } = await tx.execute<{
      lead_id: string;
      request_hash: string;
      response: unknown;
    }>(sql`SELECT lead_id, request_hash, response FROM follow_ups
      WHERE company_id = ${companyId} AND by_user_id = ${userId}
        AND request_id = ${requestId}`);
    const row = rows[0];
    return row
      ? {
          leadId: row.lead_id,
          requestHash: row.request_hash,
          response: row.response,
        }
      : null;
  },

  async insert(
    tx: TenantTx,
    input: {
      followUp: LogFollowUpResult["followUp"];
      requestId: string;
      requestHash: string;
      countsAsFailed: boolean;
      isSiteVisit: boolean;
      response: LogFollowUpWireResult;
    },
  ): Promise<void> {
    const call = input.followUp;
    await tx.execute(sql`INSERT INTO follow_ups (
      id, company_id, lead_id, by_member_id, by_user_id, outcome_id, notes,
      happened_at, next_action_at, stage_before_id, stage_after_id,
      counts_as_failed, is_site_visit, request_id, request_hash, response
    ) VALUES (
      ${call.id}, ${call.companyId}, ${call.leadId}, ${call.byMemberId},
      ${call.byUserId}, ${call.outcomeId}, ${call.notes}, ${call.happenedAt},
      ${call.nextActionAt}, ${call.stageBeforeId}, ${call.stageAfterId},
      ${input.countsAsFailed}, ${input.isSiteVisit}, ${input.requestId},
      ${input.requestHash}, ${JSON.stringify(input.response)}::jsonb
    )`);
  },

  async readForEvents(
    tx: TenantTx,
    companyId: string,
    leadId: string,
    ids: string[],
  ): Promise<LogFollowUpResult["followUp"][]> {
    if (!ids.length) return [];
    const values = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const { rows } = await tx.execute<{
      id: string;
      company_id: string;
      lead_id: string;
      by_member_id: string | null;
      by_user_id: string;
      outcome_id: string;
      notes: string | null;
      happened_at: Date;
      next_action_at: Date | null;
      stage_before_id: string;
      stage_after_id: string;
    }>(sql`SELECT id, company_id, lead_id, by_member_id, by_user_id,
        outcome_id, notes, happened_at, next_action_at, stage_before_id,
        stage_after_id
      FROM follow_ups WHERE company_id = ${companyId} AND lead_id = ${leadId}
        AND id IN (${values})`);
    return rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      leadId: row.lead_id,
      byMemberId: row.by_member_id,
      byUserId: row.by_user_id,
      outcomeId: row.outcome_id,
      notes: row.notes,
      happenedAt: new Date(row.happened_at),
      nextActionAt: row.next_action_at && new Date(row.next_action_at),
      stageBeforeId: row.stage_before_id,
      stageAfterId: row.stage_after_id,
    }));
  },

  async readMemberDayCounts(
    tx: TenantTx,
    memberId: string,
    start: Date,
    end: Date,
  ): Promise<{ callsToday: number; siteVisitsToday: number }> {
    const { rows } = await tx.execute<{
      calls: number;
      visits: number;
    }>(sql`SELECT count(*)::int AS calls,
        count(*) FILTER (WHERE is_site_visit)::int AS visits
      FROM follow_ups WHERE by_member_id = ${memberId}
        AND happened_at >= ${start} AND happened_at < ${end}`);
    const [row] = rows;
    return { callsToday: row.calls, siteVisitsToday: row.visits };
  },

  async readWeeklyCallCounts(
    tx: TenantTx,
    input: { from: Date; to: Date },
  ): Promise<{
    calls: number;
    siteVisits: number;
    staffCalls: number;
    byMember: { memberId: string; calls: number }[];
  }> {
    const { companyId } = await readCompanyScope(tx);
    const { rows } = await tx.execute<{
      member_id: string | null;
      calls: number;
      site_visits: number;
    }>(sql`SELECT by_member_id AS member_id, count(*)::int AS calls,
        count(*) FILTER (WHERE is_site_visit)::int AS site_visits
      FROM follow_ups WHERE company_id = ${companyId}
        AND happened_at >= ${input.from} AND happened_at < ${input.to}
      GROUP BY by_member_id`);
    return {
      calls: rows.reduce((total, row) => total + row.calls, 0),
      siteVisits: rows.reduce((total, row) => total + row.site_visits, 0),
      staffCalls: rows.find((row) => row.member_id === null)?.calls ?? 0,
      byMember: rows.flatMap((row) =>
        row.member_id ? [{ memberId: row.member_id, calls: row.calls }] : [],
      ),
    };
  },
};
export default repository;
