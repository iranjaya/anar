import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import type { Bucket, LeadRow, TodayCounts } from "@anar/domain/leads";
import type { Field } from "@anar/domain/settings";
import { type SQL, sql } from "drizzle-orm";
import dates from "../../lib/dates.js";

export type Day = ReturnType<typeof dates.localDayBounds>;
export type BucketCounts = Pick<
  TodayCounts,
  "overdue" | "dueToday" | "newLeads"
>;
type Key = [string, number, string];
type Row = {
  id: string;
  full_name: string | null;
  phone_e164: string | null;
  phone_valid: boolean;
  priority: LeadRow["priority"];
  score: number;
  next_action_at: Date | null;
  failed_attempts: number;
  source: LeadRow["source"];
  lead_date: Date;
  custom: Record<string, string | number | null>;
  stage_id: string;
  stage_name: string;
  member_id: string;
  member_name: string;
  assigned_at: Date | null;
  rank: number;
  bucket: Bucket;
};

const iso = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z`;
const cursorFormat = new RegExp(
  String.raw`^(overdue|due_today|new)\|(${iso})\|(${iso})\|([012])\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`,
);
const buckets = {
  // Today is the company's local day; every page of one response uses the same `at`.
  day(at: Date, timezone: string): Day {
    return dates.localDayBounds(at, timezone);
  },

  async page(
    tx: TenantTx,
    memberId: string,
    day: Day,
    bucket: Bucket,
    after: Key | null,
    limit: number,
  ): Promise<Row[]> {
    const { rows } = await tx.execute<Row>(
      buckets._pageSql(memberId, day, bucket, after, limit),
    );
    return rows;
  },

  async bucketForLead(
    tx: TenantTx,
    memberId: string,
    day: Day,
    leadId: string,
  ): Promise<Bucket | null> {
    const { rows } = await tx.execute<{ bucket: Bucket | null }>(
      sql`SELECT bucket FROM (${buckets._open(memberId, day)}) open WHERE id = ${leadId}`,
    );
    return rows[0]?.bucket ?? null;
  },

  async counts(
    tx: TenantTx,
    memberId: string,
    day: Day,
  ): Promise<BucketCounts> {
    const { rows } = await tx.execute<{ bucket: Bucket; total: number }>(
      buckets._countSql(memberId, day),
    );
    const total = (bucket: Bucket) =>
      rows.find((row) => row.bucket === bucket)?.total ?? 0;
    return {
      overdue: total("overdue"),
      dueToday: total("due_today"),
      newLeads: total("new"),
    };
  },

  _pageSql(
    memberId: string,
    day: Day,
    bucket: Bucket,
    after: Key | null,
    limit: number,
  ): SQL {
    const order =
      bucket === "new"
        ? sql`rank, assigned_at, id`
        : sql`next_action_at, rank, id`;
    const past = after
      ? bucket === "new"
        ? sql`AND (rank, assigned_at, id) > (${after[1]}, ${after[0]}::timestamptz, ${after[2]}::uuid)`
        : sql`AND (next_action_at, rank, id) > (${after[0]}::timestamptz, ${after[1]}, ${after[2]}::uuid)`
      : sql``;
    return sql`SELECT * FROM (${buckets._open(memberId, day)}) open
      WHERE bucket = ${bucket} ${past} ORDER BY ${order} LIMIT ${limit}`;
  },

  _countSql(memberId: string, day: Day): SQL {
    return sql`SELECT bucket, count(*)::int AS total FROM (${buckets._open(memberId, day)}) open
      WHERE bucket IS NOT NULL GROUP BY bucket`;
  },

  // Anything assigned, even closed, so "nothing assigned" and "all caught up" stay different.
  async summary(
    tx: TenantTx,
    memberId: string,
    day: Day,
  ): Promise<{
    hasAssignedLeads: boolean;
    nextDueAt: Date | null;
    bookingsToday: number;
  }> {
    const { rows } = await tx.execute<{
      has_assigned: boolean;
      next_due_at: Date | null;
      bookings: number;
    }>(sql`SELECT
      EXISTS (SELECT 1 FROM leads WHERE assigned_to = ${memberId}
        AND merged_into_id IS NULL AND deleted_at IS NULL) AS has_assigned,
      (SELECT min(next_action_at) FROM (${buckets._open(memberId, day)}) open
        WHERE next_action_at >= ${day.end}) AS next_due_at,
      (SELECT count(*)::int FROM lead_events WHERE type = 'stage_changed'
        AND actor_member_id = ${memberId}
        AND created_at >= ${day.start} AND created_at < ${day.end}
        AND data->>'toKind' = 'won' AND data->>'fromKind' <> 'won') AS bookings`);
    const [row] = rows;
    return {
      hasAssignedLeads: row.has_assigned,
      nextDueAt: row.next_due_at && new Date(row.next_due_at),
      bookingsToday: row.bookings,
    };
  },

  async isActiveMember(tx: TenantTx, memberId: string): Promise<boolean> {
    const { rows } = await tx.execute<{ id: string }>(
      sql`SELECT id FROM company_members WHERE id = ${memberId} AND status = 'active'`,
    );
    return rows.length > 0;
  },

  row(row: Row, fields: Field[]): LeadRow {
    return {
      id: row.id,
      fullName: row.full_name,
      phoneE164: row.phone_e164,
      phoneValid: row.phone_valid,
      priority: row.priority,
      score: row.score,
      nextActionAt: row.next_action_at && new Date(row.next_action_at),
      failedAttempts: row.failed_attempts,
      source: row.source,
      leadDate: new Date(row.lead_date),
      stage: { id: row.stage_id, name: row.stage_name, kind: "open" },
      answers: fields.flatMap((field) => {
        const option = field.options?.find(
          (option) => option.value === row.custom[field.key],
        );
        return option ? [{ key: field.key, label: option.label }] : [];
      }),
      assignedAt: row.assigned_at && new Date(row.assigned_at),
      assignee: { memberId: row.member_id, name: row.member_name },
      bucket: row.bucket,
    };
  },

  encode(bucket: Bucket, day: Day, row: Row): string {
    const first = bucket === "new" ? row.assigned_at : row.next_action_at;
    const key = new Date(first as Date).toISOString();
    return Buffer.from(
      [bucket, day.at.toISOString(), key, row.rank, row.id].join("|"),
    ).toString("base64url");
  },

  // The cursor keeps the first page's `at`, so later pages read the same day.
  decode(value: string, bucket: Bucket): { at: Date; key: Key } {
    const match = cursorFormat.exec(Buffer.from(value, "base64url").toString());
    const [, used, at, key, rank, id] = match ?? [];
    const real = (text: string) => {
      const date = new Date(text);
      return !Number.isNaN(date.getTime()) && date.toISOString() === text;
    };
    if (!match || used !== bucket || !real(at) || !real(key))
      throw new AppError("validation", "This page of leads is not valid");
    return { at: new Date(at), key: [key, Number(rank), id] };
  },

  // The one place that decides a lead's bucket. Open, live, assigned to an active member.
  // New means assigned to this member in the last 24 hours and never called.
  _open(memberId: string, day: Day): SQL {
    return sql`SELECT l.id, l.full_name, l.phone_e164, l.phone_valid, l.priority,
        l.score, l.next_action_at, l.failed_attempts, l.source, l.lead_date, l.custom,
        s.id AS stage_id, s.name AS stage_name, m.id AS member_id, m.name AS member_name,
        a.created_at AS assigned_at,
        CASE l.priority WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END AS rank,
        CASE
          WHEN l.next_action_at < ${day.at} THEN 'overdue'
          WHEN l.next_action_at < ${day.end} THEN 'due_today'
          WHEN l.last_contacted_at IS NULL AND a.to_member = ${memberId}
            AND a.created_at <= ${day.at} AND a.created_at > ${day.dayAgo} THEN 'new'
        END AS bucket
      FROM leads l
      JOIN stages s ON s.company_id = l.company_id AND s.id = l.stage_id AND s.kind = 'open'
      JOIN company_members m ON m.company_id = l.company_id AND m.id = l.assigned_to
        AND m.status = 'active'
      LEFT JOIN LATERAL (
        SELECT e.created_at, e.data->>'to' AS to_member FROM lead_events e
        WHERE e.lead_id = l.id AND e.type = 'assigned'
        ORDER BY e.created_at DESC, e.id DESC LIMIT 1
      ) a ON true
      WHERE l.assigned_to = ${memberId} AND l.merged_into_id IS NULL AND l.deleted_at IS NULL`;
  },
};
export default buckets;
