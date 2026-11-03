import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import type { NotificationInput } from "@anar/domain/notifications";
import dates from "../../lib/dates.js";
import type { JobControl } from "../../lib/jobs/index.js";
import type { DueFollowUp } from "../leads/due.js";

type Scope = {
  agencyId: string;
  companyId: string;
  authority: "scheduler";
};
type Period = {
  at: Date;
  timezone: string;
  localDate: string;
  cursor: string | null;
};
export type OverdueScanInput = {
  agencyId: string;
  companyId: string;
  slot: string;
};
export type OverdueScanDeps = {
  now(): Date;
  withSystemTenant<T>(
    scope: Scope,
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
  readScopedCompanyTimezone(tx: TenantTx): Promise<string>;
  readScopedCompanySlug(tx: TenantTx): Promise<string>;
  openPeriod(
    tx: TenantTx,
    input: { slot: string; at: Date; timezone: string; localDate: string },
  ): Promise<Period | null>;
  checkpointPeriod(
    tx: TenantTx,
    input: { slot: string; cursor: string | null; done: boolean },
  ): Promise<void>;
  listDueFollowUps(
    tx: TenantTx,
    input: { at: Date; afterLeadId?: string; limit: 100 },
  ): Promise<{ items: DueFollowUp[]; nextId: string | null }>;
  hasNotification(
    tx: TenantTx,
    userId: string,
    dedupeKey: string,
  ): Promise<boolean>;
  canReceiveCompanyNotification(tx: TenantTx, userId: string): Promise<boolean>;
  notify(tx: TenantTx, input: NotificationInput): Promise<{ id: string }>;
};

const overdue = {
  create(deps: OverdueScanDeps) {
    return {
      async scan(input: OverdueScanInput, control: JobControl): Promise<void> {
        overdue._slot(input.slot);
        let done = false;
        while (!done) {
          control.signal.throwIfAborted();
          let page: Awaited<ReturnType<typeof overdue._page>>;
          try {
            page = await deps.withSystemTenant(
              {
                agencyId: input.agencyId,
                companyId: input.companyId,
                authority: "scheduler",
              },
              (tx) => overdue._page(deps, tx, input, control),
            );
          } catch (error) {
            if (error instanceof AppError && error.code === "not_found") return;
            throw error;
          }
          if (page === null) return;
          done = page.done;
        }
      },
    };
  },

  _slot(value: string): void {
    const at = new Date(value);
    if (
      Number.isNaN(at.getTime()) ||
      at.toISOString() !== value ||
      at.getUTCMinutes() % 30 !== 0 ||
      at.getUTCSeconds() !== 0 ||
      at.getUTCMilliseconds() !== 0
    )
      throw new AppError("validation", "Overdue scan slot is not valid");
  },

  async _page(
    deps: OverdueScanDeps,
    tx: TenantTx,
    input: OverdueScanInput,
    control: JobControl,
  ): Promise<{ done: boolean } | null> {
    const at = deps.now();
    const timezone = await deps.readScopedCompanyTimezone(tx);
    const period = await deps.openPeriod(tx, {
      slot: input.slot,
      at,
      timezone,
      localDate: dates.localDate(at, timezone),
    });
    if (!period) return null;
    const page = await deps.listDueFollowUps(tx, {
      at: period.at,
      ...(period.cursor ? { afterLeadId: period.cursor } : {}),
      limit: 100,
    });
    const slug = await deps.readScopedCompanySlug(tx);
    for (const lead of page.items) {
      control.signal.throwIfAborted();
      const dedupeKey = `overdue:${input.companyId}:${lead.leadId}:${period.localDate}`;
      if (await deps.hasNotification(tx, lead.userId, dedupeKey)) continue;
      if (!(await deps.canReceiveCompanyNotification(tx, lead.userId)))
        continue;
      await deps.notify(tx, {
        companyId: input.companyId,
        userId: lead.userId,
        title: "Follow-up overdue",
        body: "A follow-up is overdue. Review this lead.",
        url: `/${slug}/leads/${lead.leadId}`,
        dedupeKey,
        data: {
          type: "overdue",
          leadId: lead.leadId,
          localDate: period.localDate,
        },
      });
    }
    const done = page.nextId === null;
    control.signal.throwIfAborted();
    await deps.checkpointPeriod(tx, {
      slot: input.slot,
      cursor: page.items.at(-1)?.leadId ?? period.cursor,
      done,
    });
    return { done };
  },
};
export type OverdueScanService = ReturnType<typeof overdue.create>;
export default overdue;
