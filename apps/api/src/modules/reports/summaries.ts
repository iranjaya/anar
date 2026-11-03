import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import type { NotificationInput } from "@anar/domain/notifications";
import dates from "../../lib/dates.js";
import type { JobControl } from "../../lib/jobs/index.js";
import type summaryRepository from "./summaryRepository.js";

type DailyCounts = { overdue: number; dueToday: number; newLeads: number };
type WeeklyCounts = {
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
type Rank = { name: string; calls: number; tied: boolean };
type WeeklyData = {
  type: "weekly";
  weekStart: string;
  leads: number;
  calls: number;
  siteVisits: number;
  bookings: number;
  overdue: number;
  staffCalls: number;
  top: Rank | null;
  bottom: Rank | null;
};
type WeeklySnapshot = {
  data: WeeklyData;
  body: string;
  recipients: string[];
};
type DailyData = Extract<NotificationInput["data"], { type: "daily" }>;
type DailySnapshot = {
  recipients: { userId: string; data: DailyData; body: string }[];
};
type SummaryNotice = Omit<NotificationInput, "data"> & {
  data: DailyData | WeeklyData;
};
export type SummaryJob = {
  agencyId: string;
  companyId: string;
  period: "daily" | "weekly";
  localDate: string;
};
export type SummaryDeps = Pick<
  typeof summaryRepository,
  | "openPeriod"
  | "checkpoint"
  | "listDailyAdmins"
  | "listWeeklyManagers"
  | "isActiveManager"
  | "isActiveAdmin"
> & {
  now(): Date;
  withSystemTenant<T>(
    scope: {
      agencyId: string;
      companyId: string;
      authority: "scheduler";
    },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
  readScopedCompanyTimezone(tx: TenantTx): Promise<string>;
  readScopedCompanySlug(tx: TenantTx): Promise<string>;
  readDailyCounts(
    tx: TenantTx,
    input: { memberId: string; at: Date; timezone: string },
  ): Promise<DailyCounts>;
  readWeeklyCounts(
    tx: TenantTx,
    input: { from: Date; to: Date; at: Date },
  ): Promise<WeeklyCounts>;
  hasNotification(
    tx: TenantTx,
    userId: string,
    dedupeKey: string,
  ): Promise<boolean>;
  canReceiveCompanyNotification(tx: TenantTx, userId: string): Promise<boolean>;
  notify(tx: TenantTx, input: SummaryNotice): Promise<{ id: string }>;
};

const summaries = {
  create(deps: SummaryDeps) {
    return {
      async run(job: SummaryJob, control: JobControl): Promise<void> {
        if (!summaries._validLocalDate(job.localDate))
          throw new AppError("validation", "Summary period is not valid");
        for (;;) {
          control.signal.throwIfAborted();
          let page: { done: boolean } | null;
          try {
            page = await deps.withSystemTenant(
              {
                agencyId: job.agencyId,
                companyId: job.companyId,
                authority: "scheduler",
              },
              (tx) => summaries._page(deps, tx, job, control),
            );
          } catch (error) {
            if (error instanceof AppError && error.code === "not_found") return;
            throw error;
          }
          if (!page || page.done) return;
        }
      },
    };
  },

  _validLocalDate(value: string): boolean {
    const at = new Date(`${value}T00:00:00.000Z`);
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(at.getTime()) &&
      at.toISOString().slice(0, 10) === value
    );
  },

  _parseWeeklySnapshot(value: unknown): WeeklySnapshot {
    const snapshot = value as WeeklySnapshot | null;
    if (
      snapshot?.data?.type !== "weekly" ||
      typeof snapshot.body !== "string" ||
      !Array.isArray(snapshot.recipients) ||
      !snapshot.recipients.every((id) => typeof id === "string")
    )
      throw new Error("Weekly summary snapshot is not valid");
    return snapshot;
  },

  _parseDailySnapshot(value: unknown): DailySnapshot {
    const snapshot = value as DailySnapshot | null;
    if (!Array.isArray(snapshot?.recipients))
      throw new Error("Daily summary snapshot is not valid");
    return snapshot;
  },

  async _page(
    deps: SummaryDeps,
    tx: TenantTx,
    job: SummaryJob,
    control: JobControl,
  ): Promise<{ done: boolean } | null> {
    const at = deps.now();
    const timezone = await deps.readScopedCompanyTimezone(tx);
    if (!summaries._due(job, at, timezone)) return null;
    const period = await deps.openPeriod(tx, {
      kind: job.period,
      key: job.localDate,
      at,
      timezone,
      snapshot: () =>
        job.period === "daily"
          ? summaries._dailySnapshot(deps, tx, job, at, timezone, control)
          : summaries._weeklySnapshot(
              deps,
              tx,
              dates.previousLocalWeekBounds(at, timezone),
              at,
              timezone,
              control,
            ),
    });
    if (!period || !summaries._due(job, deps.now(), period.timezone))
      return null;
    return job.period === "daily"
      ? summaries._dailyPage(deps, tx, job, period, control)
      : summaries._weeklyPage(deps, tx, job, period, control);
  },

  _localClock(at: Date, timezone: string) {
    const shown = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(at)
        .map((part) => [part.type, part.value]),
    );
    return {
      weekday: shown.weekday,
      hour: Number(shown.hour),
      minute: Number(shown.minute),
    };
  },

  _due(job: SummaryJob, at: Date, timezone: string): boolean {
    const clock = summaries._localClock(at, timezone);
    if (job.period === "daily")
      return dates.localDate(at, timezone) === job.localDate && clock.hour >= 8;
    return (
      dates.previousLocalWeekBounds(at, timezone).weekStart === job.localDate &&
      (clock.weekday !== "Mon" || clock.hour >= 8)
    );
  },

  _delayed(kind: "daily" | "weekly", at: Date, timezone: string): boolean {
    const clock = summaries._localClock(at, timezone);
    return (
      (kind === "weekly" && clock.weekday !== "Mon") ||
      clock.hour > 8 ||
      (clock.hour === 8 && clock.minute >= 5)
    );
  },

  async _dailySnapshot(
    deps: SummaryDeps,
    tx: TenantTx,
    job: SummaryJob,
    at: Date,
    timezone: string,
    control: JobControl,
  ): Promise<Record<string, unknown>> {
    const recipients: DailySnapshot["recipients"] = [];
    const delayed = summaries._delayed("daily", at, timezone);
    let cursor: string | undefined;
    for (;;) {
      control.signal.throwIfAborted();
      const page = await deps.listDailyAdmins(tx, {
        ...(cursor ? { afterMemberId: cursor } : {}),
        limit: 100,
      });
      for (const member of page.items) {
        control.signal.throwIfAborted();
        if (!(await deps.canReceiveCompanyNotification(tx, member.userId)))
          continue;
        const counts = await deps.readDailyCounts(tx, {
          memberId: member.memberId,
          at,
          timezone,
        });
        if (!counts.overdue && !counts.dueToday && !counts.newLeads) continue;
        recipients.push({
          userId: member.userId,
          body: `${delayed ? "Delayed: " : ""}${counts.overdue} overdue, ${counts.dueToday} due today, ${counts.newLeads} new.`,
          data: { type: "daily", localDate: job.localDate, ...counts },
        });
      }
      if (!page.nextId) break;
      cursor = page.nextId;
    }
    return { recipients };
  },

  async _dailyPage(
    deps: SummaryDeps,
    tx: TenantTx,
    job: SummaryJob,
    period: NonNullable<Awaited<ReturnType<SummaryDeps["openPeriod"]>>>,
    control: JobControl,
  ): Promise<{ done: boolean }> {
    const snapshot = summaries._parseDailySnapshot(period.snapshot);
    const start = period.cursor ? Number(period.cursor) : 0;
    if (!Number.isSafeInteger(start) || start < 0)
      throw new Error("Summary cursor is not valid");
    const page = snapshot.recipients.slice(start, start + 100);
    const slug = await deps.readScopedCompanySlug(tx);
    for (const recipient of page) {
      control.signal.throwIfAborted();
      if (!(await deps.isActiveAdmin(tx, recipient.userId))) continue;
      if (!(await deps.canReceiveCompanyNotification(tx, recipient.userId)))
        continue;
      const dedupeKey = `daily:${job.companyId}:${job.localDate}`;
      if (await deps.hasNotification(tx, recipient.userId, dedupeKey)) continue;
      await deps.notify(tx, {
        companyId: job.companyId,
        userId: recipient.userId,
        title: "Today's leads",
        body: recipient.body,
        url: `/${slug}/today`,
        dedupeKey,
        data: recipient.data,
      });
    }
    const cursor = start + page.length;
    const done = cursor >= snapshot.recipients.length;
    control.signal.throwIfAborted();
    await deps.checkpoint(tx, {
      kind: "daily",
      key: job.localDate,
      cursor: String(cursor),
      done,
    });
    return { done };
  },

  async _weeklySnapshot(
    deps: SummaryDeps,
    tx: TenantTx,
    bounds: ReturnType<typeof dates.previousLocalWeekBounds>,
    at: Date,
    timezone: string,
    control: JobControl,
  ): Promise<Record<string, unknown>> {
    const counts = await deps.readWeeklyCounts(tx, {
      from: bounds.start,
      to: bounds.end,
      at,
    });
    const sorted = [...counts.byAdmin].sort(
      (left, right) =>
        right.calls - left.calls || left.memberId.localeCompare(right.memberId),
    );
    const top = sorted[0];
    const bottom = sorted.at(-1);
    const data: WeeklyData = {
      type: "weekly",
      weekStart: bounds.weekStart,
      leads: counts.leads,
      calls: counts.calls,
      siteVisits: counts.siteVisits,
      bookings: counts.bookings,
      overdue: counts.overdue,
      staffCalls: counts.staffCalls,
      top:
        sorted.length >= 2 && top
          ? {
              name: top.name,
              calls: top.calls,
              tied: top.calls === sorted[1].calls,
            }
          : null,
      bottom:
        sorted.length >= 2 && bottom
          ? {
              name: bottom.name,
              calls: bottom.calls,
              tied: bottom.calls === sorted.at(-2)?.calls,
            }
          : null,
    };
    const recipients: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      control.signal.throwIfAborted();
      const page = await deps.listWeeklyManagers(tx, {
        ...(cursor ? { afterMemberId: cursor } : {}),
        limit: 100,
      });
      for (const manager of page.items) {
        control.signal.throwIfAborted();
        if (await deps.canReceiveCompanyNotification(tx, manager.userId))
          recipients.push(manager.userId);
      }
      if (!page.nextId) break;
      cursor = page.nextId;
    }
    return {
      data,
      body: `${summaries._delayed("weekly", at, timezone) ? "Delayed: " : ""}${summaries._weeklyBody(data)}`,
      recipients,
    };
  },

  _weeklyBody(data: WeeklyData): string {
    const parts = [
      `${data.leads} leads, ${data.calls} calls, ${data.siteVisits} visits, ${data.bookings} bookings, ${data.overdue} overdue.`,
      `${data.staffCalls} staff calls.`,
    ];
    if (data.top && data.bottom) {
      parts.push(
        `Top: ${data.top.name.slice(0, 60)} (${data.top.calls}${data.top.tied ? ", tied" : ""}).`,
        `Bottom: ${data.bottom.name.slice(0, 60)} (${data.bottom.calls}${data.bottom.tied ? ", tied" : ""}).`,
      );
    }
    return parts.join(" ");
  },

  async _weeklyPage(
    deps: SummaryDeps,
    tx: TenantTx,
    job: SummaryJob,
    period: NonNullable<Awaited<ReturnType<SummaryDeps["openPeriod"]>>>,
    control: JobControl,
  ): Promise<{ done: boolean }> {
    const snapshot = summaries._parseWeeklySnapshot(period.snapshot);
    const start = period.cursor ? Number(period.cursor) : 0;
    if (!Number.isSafeInteger(start) || start < 0)
      throw new Error("Summary cursor is not valid");
    const page = snapshot.recipients.slice(start, start + 100);
    const slug = await deps.readScopedCompanySlug(tx);
    for (const userId of page) {
      control.signal.throwIfAborted();
      if (!(await deps.isActiveManager(tx, userId))) continue;
      if (!(await deps.canReceiveCompanyNotification(tx, userId))) continue;
      const dedupeKey = `weekly:${job.companyId}:${snapshot.data.weekStart}`;
      if (await deps.hasNotification(tx, userId, dedupeKey)) continue;
      await deps.notify(tx, {
        companyId: job.companyId,
        userId,
        title: "Weekly summary",
        body: snapshot.body,
        url: `/${slug}/notifications`,
        dedupeKey,
        data: snapshot.data,
      });
    }
    const cursor = start + page.length;
    const done = cursor >= snapshot.recipients.length;
    control.signal.throwIfAborted();
    await deps.checkpoint(tx, {
      kind: "weekly",
      key: job.localDate,
      cursor: String(cursor),
      done,
    });
    return { done };
  },
};
export type SummaryService = ReturnType<typeof summaries.create>;
export default summaries;
