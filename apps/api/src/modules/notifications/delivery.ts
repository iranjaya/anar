import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import type { NotificationDeliveryJob } from "@anar/domain/jobs";
import type { NotificationData } from "@anar/domain/notifications";
import dates from "../../lib/dates.js";
import { enqueue, type JobControl } from "../../lib/jobs/index.js";
import tenant from "../tenant/index.js";
import push, { type PushResponse, type SendPush } from "./push.js";
import repository, { type ClaimedPush } from "./repository.js";

export type LivePushBinding = {
  userId: string;
  sessionId: string;
  actingCompanyId: string | null;
  actingUntil: Date | null;
};
type SystemTenant = Awaited<ReturnType<typeof tenant.startSystem>>;
export type DeliveryDeps = {
  withSystemTenant: SystemTenant["withSystemTenant"];
  now(): Date;
  sendPush: SendPush;
  canReceiveCompanyNotification(tx: TenantTx, userId: string): Promise<boolean>;
  isScopedCompanyMember(tx: TenantTx, userId: string): Promise<boolean>;
  readScopedCompanyTimezone(tx: TenantTx): Promise<string>;
  readLivePushBinding(
    tx: TenantTx,
    endpointHash: string,
  ): Promise<LivePushBinding | undefined>;
  queueSummaryEmail?(tx: TenantTx, job: NotificationDeliveryJob): Promise<void>;
};
type Due = NonNullable<
  Awaited<ReturnType<typeof repository.readNotification>>
> & {
  expiresAt: Date;
};

const maxAttempts = 4;
const leaseMs = 30_000;
const maxRetryAfterMs = 120_000;
const day = 24 * 60 * 60 * 1000;

const delivery = {
  create(deps: DeliveryDeps) {
    return {
      async deliverPush(
        job: NotificationDeliveryJob,
        control: JobControl,
      ): Promise<void> {
        const run = <T>(fn: (tx: TenantTx) => Promise<T>) =>
          deps.withSystemTenant(
            {
              agencyId: job.agencyId,
              companyId: job.companyId,
              authority: "scheduler",
            },
            fn,
          );
        let due: Due | null;
        try {
          due = await run((tx) =>
            delivery._prepare(deps, tx, job.notificationId),
          );
        } catch (error) {
          if (error instanceof AppError && error.code === "not_found") return;
          throw error;
        }
        if (!due) return;
        const tried: string[] = [];
        for (;;) {
          control.signal.throwIfAborted();
          const claimed = await run((tx) =>
            delivery._claim(deps, tx, due, tried),
          );
          if (!claimed.length) break;
          tried.push(...claimed.map((target) => target.id));
          await Promise.all(
            claimed.map(async (target) => {
              const response = await delivery._send(
                deps,
                due,
                target,
                control.signal,
              );
              await run((tx) =>
                delivery._finish(deps, tx, due, target, response),
              );
            }),
          );
        }
        await run(async (tx) => {
          await repository.lockNotification(tx, due.id);
          const at = deps.now();
          const nextAt = await repository.nextOpenPushAt(tx, due.id, at);
          if (nextAt) {
            if (nextAt <= at) throw new Error("Some push targets will retry");
            try {
              await enqueue(
                tx,
                "notify.push",
                job,
                `push-wait:${job.companyId}:${job.notificationId}:${nextAt.toISOString()}`,
                nextAt,
              );
            } catch (error) {
              if (
                !(error instanceof Error) ||
                error.message !== "Queue refused the job"
              )
                throw error;
            }
            return;
          }
          if (due.type === "daily" || due.type === "weekly") {
            const current = await repository.readNotification(tx, due.id);
            if (!current || current.pushedAt) return;
            if (!deps.queueSummaryEmail)
              throw new Error("Summary email queue is unavailable");
            await repository.reserveEmailFallback(tx, {
              companyId: due.companyId,
              notificationId: due.id,
              expiresAt: due.expiresAt,
              at,
            });
            await deps.queueSummaryEmail(tx, job);
          }
        });
      },
    };
  },
  async start(
    options: Omit<DeliveryDeps, "withSystemTenant"> & {
      connectionString: string;
    },
  ) {
    const { withSystemTenant, close } = await tenant.startSystem(
      options.connectionString,
    );
    return {
      service: delivery.create({ ...options, withSystemTenant }),
      close,
    };
  },

  async _prepare(
    deps: DeliveryDeps,
    tx: TenantTx,
    notificationId: string,
  ): Promise<Due | null> {
    await repository.lockNotification(tx, notificationId);
    const notification = await repository.readNotification(tx, notificationId);
    if (!notification) return null;
    if (await repository.hasEmailFallback(tx, notificationId)) return null;
    const at = deps.now();
    const due = {
      ...notification,
      expiresAt: delivery._expiresAt(
        notification,
        await deps.readScopedCompanyTimezone(tx),
      ),
    };
    if (!(await delivery._recipientOk(deps, tx, due, at))) return null;
    const owner = { companyId: due.companyId, userId: due.userId };
    let after: string | null = null;
    for (;;) {
      const page = await repository.listLiveSubscriptions(tx, owner, at, after);
      if (!page.length) break;
      await repository.addPushTargets(
        tx,
        due,
        page.map((row) => ({ subscriptionId: row.id, state: "pending" })),
        due.expiresAt,
        at,
      );
      after = page[page.length - 1].id;
    }
    if (!(await repository.hasPushTargets(tx, due.id)))
      await repository.addPushTargets(
        tx,
        due,
        [{ subscriptionId: null, state: "skipped" }],
        due.expiresAt,
        at,
      );
    return due;
  },
  async _claim(
    deps: DeliveryDeps,
    tx: TenantTx,
    due: Due,
    tried: string[],
  ): Promise<ClaimedPush[]> {
    const at = deps.now();
    if (!(await delivery._recipientOk(deps, tx, due, at))) return [];
    const member = await deps.isScopedCompanyMember(tx, due.userId);
    const claimed = await repository.claimPush(
      tx,
      due.id,
      tried,
      at,
      new Date(at.getTime() + leaseMs),
    );
    const sendable: ClaimedPush[] = [];
    for (const target of claimed) {
      if (await delivery._targetOk(deps, tx, due, target, member, at))
        sendable.push(target);
      else
        await repository.finishDelivery(
          tx,
          target,
          { state: "skipped", leaseUntil: null },
          at,
        );
    }
    return sendable;
  },
  async _recipientOk(
    deps: DeliveryDeps,
    tx: TenantTx,
    due: Due,
    at: Date,
  ): Promise<boolean> {
    if (
      at < due.expiresAt &&
      (await deps.canReceiveCompanyNotification(tx, due.userId))
    )
      return true;
    await repository.skipOpenPush(tx, due.id, at);
    return false;
  },
  async _targetOk(
    deps: DeliveryDeps,
    tx: TenantTx,
    due: Due,
    target: ClaimedPush,
    member: boolean,
    at: Date,
  ): Promise<boolean> {
    if (target.disabledAt || (target.expiresAt && target.expiresAt <= at))
      return false;
    const binding = await deps.readLivePushBinding(tx, target.endpointHash);
    if (
      binding?.userId !== due.userId ||
      binding.sessionId !== target.sessionId
    )
      return false;
    if (member) return true;
    return (
      binding.actingCompanyId === due.companyId &&
      binding.actingUntil !== null &&
      binding.actingUntil > at
    );
  },
  async _send(
    deps: DeliveryDeps,
    due: Due,
    target: ClaimedPush,
    signal: AbortSignal,
  ): Promise<PushResponse> {
    const ttl = Math.floor(
      (due.expiresAt.getTime() - deps.now().getTime()) / 1000,
    );
    try {
      return await deps.sendPush(
        target,
        push.message(due),
        Math.max(ttl, 1),
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw error;
      return { status: 0, retryAfter: null };
    }
  },
  async _finish(
    deps: DeliveryDeps,
    tx: TenantTx,
    due: Due,
    target: ClaimedPush,
    response: PushResponse,
  ): Promise<void> {
    const at = deps.now();
    const { status } = response;
    if (status >= 200 && status < 300) {
      const sent = await repository.finishDelivery(
        tx,
        target,
        { state: "sent", leaseUntil: null, deliveredAt: at },
        at,
      );
      if (sent) await repository.markPushed(tx, due.id, at);
      return;
    }
    if (status === 404 || status === 410)
      await repository.disableSubscription(tx, target.subscriptionId, at);
    const notBefore = new Date(
      at.getTime() + delivery._retryAfterMs(response.retryAfter, at),
    );
    const retry =
      (status === 0 || status === 429 || status >= 500) &&
      target.attempts < maxAttempts &&
      notBefore < due.expiresAt;
    await repository.finishDelivery(
      tx,
      target,
      retry
        ? { state: "pending", leaseUntil: notBefore }
        : { state: "failed", leaseUntil: null },
      at,
    );
  },
  _retryAfterMs(header: string | null, at: Date): number {
    if (!header) return 0;
    const wait = /^\d+$/.test(header)
      ? Number(header) * 1000
      : Date.parse(header) - at.getTime();
    if (Number.isNaN(wait)) return 0;
    return Math.min(Math.max(wait, 0), maxRetryAfterMs);
  },
  _expiresAt(
    notification: Pick<Due, "createdAt" | "data">,
    timezone: string,
  ): Date {
    const data = notification.data as NotificationData;
    switch (data.type) {
      case "overdue":
      case "daily":
        return dates.localMidnight(data.localDate, 1, timezone);
      case "weekly":
        return dates.localMidnight(data.weekStart, 14, timezone);
      default:
        return new Date(notification.createdAt.getTime() + day);
    }
  },
};
export type DeliveryService = ReturnType<typeof delivery.create>;
export default delivery;
