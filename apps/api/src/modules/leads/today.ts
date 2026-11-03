import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type Bucket,
  type BucketPage,
  type BucketQuery,
  bucketQuerySchema,
  type TodayResult,
} from "@anar/domain/leads";
import type { CompanySchema, Field } from "@anar/domain/settings";
import type { FastifyRequest } from "fastify";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import buckets, { type BucketCounts, type Day } from "./buckets.js";

export type TodayDeps = {
  context: Pick<
    ReturnType<typeof tenant.create>,
    "requireContext" | "withContext"
  >;
  loadSchema(tx: TenantTx): Promise<CompanySchema>;
  readMemberDayCounts(
    tx: TenantTx,
    memberId: string,
    start: Date,
    end: Date,
  ): Promise<{ callsToday: number; siteVisitsToday: number }>;
  now(): Date;
};
const pageSize = 50;

const today = {
  create(deps: TodayDeps) {
    return {
      requireContext(
        request: Pick<FastifyRequest, "headers">,
        slug: string,
      ): Promise<Ctx> {
        return deps.context.requireContext(request, slug);
      },
      getMyToday(actor: Ctx): Promise<TodayResult> {
        const at = deps.now();
        return deps.context.withContext(actor, async (tx, current) => {
          const memberId = today._ownMember(current);
          const day = buckets.day(at, current.company.timezone);
          const fields = await today._fields(deps, tx);
          const overdue = await today._page(
            tx,
            memberId,
            day,
            "overdue",
            null,
            fields,
          );
          const dueToday = await today._page(
            tx,
            memberId,
            day,
            "due_today",
            null,
            fields,
          );
          const newLeads = await today._page(
            tx,
            memberId,
            day,
            "new",
            null,
            fields,
          );
          const counts = await buckets.counts(tx, memberId, day);
          const { hasAssignedLeads, nextDueAt, bookingsToday } =
            await buckets.summary(tx, memberId, day);
          const callCounts = await deps.readMemberDayCounts(
            tx,
            memberId,
            day.start,
            day.end,
          );
          return {
            overdue: overdue.items,
            dueToday: dueToday.items,
            newLeads: newLeads.items,
            counts: {
              ...counts,
              callsToday: callCounts.callsToday,
              callsTarget: null,
              siteVisitsToday: callCounts.siteVisitsToday,
              bookingsToday,
              nextDueAt,
            },
            hasAssignedLeads,
            nextCursors: {
              overdue: overdue.nextCursor,
              dueToday: dueToday.nextCursor,
              newLeads: newLeads.nextCursor,
            },
          };
        });
      },
      async listTodayBucket(actor: Ctx, raw: BucketQuery): Promise<BucketPage> {
        const parsed = bucketQuerySchema.safeParse(raw);
        if (!parsed.success)
          throw new AppError("validation", "This page of leads is not valid");
        const { bucket, cursor } = parsed.data;
        const after = cursor ? buckets.decode(cursor, bucket) : null;
        const at = after?.at ?? deps.now();
        return deps.context.withContext(actor, async (tx, current) => {
          const memberId = today._ownMember(current);
          const day = buckets.day(at, current.company.timezone);
          const fields = await today._fields(deps, tx);
          const page = await today._page(
            tx,
            memberId,
            day,
            bucket,
            after?.key ?? null,
            fields,
          );
          const counts = await buckets.counts(tx, memberId, day);
          return { ...page, total: today._total(counts, bucket) };
        });
      },
      getBucketCounts(actor: Ctx, memberId: string): Promise<BucketCounts> {
        const at = deps.now();
        return deps.context.withContext(actor, async (tx, current) => {
          if (
            current.member?.id !== memberId &&
            !permissions.can(current, "reports.view_all")
          )
            throw new AppError("forbidden", "This action is not allowed");
          if (!(await buckets.isActiveMember(tx, memberId)))
            throw new AppError("not_found", "Member not found");
          return buckets.counts(
            tx,
            memberId,
            buckets.day(at, current.company.timezone),
          );
        });
      },
    };
  },

  // Today is personal: entered agency staff have no membership, so no Today.
  _ownMember(current: Ctx): string {
    permissions.require(current, "reports.view_own");
    if (!current.member)
      throw new AppError("forbidden", "This action is not allowed");
    return current.member.id;
  },

  async _fields(deps: TodayDeps, tx: TenantTx): Promise<Field[]> {
    return (await deps.loadSchema(tx)).fields
      .filter((field) => field.type === "dropdown")
      .sort((a, b) => a.position - b.position);
  },

  async _page(
    tx: TenantTx,
    memberId: string,
    day: Day,
    bucket: Bucket,
    after: Parameters<typeof buckets.page>[4],
    fields: Field[],
  ): Promise<Omit<BucketPage, "total">> {
    const rows = await buckets.page(
      tx,
      memberId,
      day,
      bucket,
      after,
      pageSize + 1,
    );
    const shown = rows.slice(0, pageSize);
    const last = shown.at(-1);
    return {
      items: shown.map((row) => buckets.row(row, fields)),
      nextCursor:
        rows.length > pageSize && last
          ? buckets.encode(bucket, day, last)
          : null,
    };
  },

  _total(counts: BucketCounts, bucket: Bucket): number {
    if (bucket === "overdue") return counts.overdue;
    if (bucket === "due_today") return counts.dueToday;
    return counts.newLeads;
  },
};
export type TodayService = ReturnType<typeof today.create>;
export default today;
