import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import type { EmailMessage, NotificationDeliveryJob } from "@anar/domain/jobs";
import type { NotificationData } from "@anar/domain/notifications";
import dates from "../../lib/dates.js";
import type { createMailCodec } from "../../lib/email/crypto.js";
import type { createEmailSender } from "../../lib/email/index.js";
import type { JobControl } from "../../lib/jobs/index.js";
import type tenant from "../tenant/index.js";
import delivery from "./delivery.js";
import type summaryEmailRepository from "./summaryEmailRepository.js";

type DailyData = Extract<NotificationData, { type: "daily" }>;
type Rank = { name: string; calls: number; tied: boolean };
type WeeklyData = Extract<NotificationData, { type: "weekly" }> & {
  staffCalls: number;
  top: Rank | null;
  bottom: Rank | null;
};
type SummaryData = DailyData | WeeklyData;
type Candidate = NonNullable<
  Awaited<ReturnType<typeof summaryEmailRepository.readCandidate>>
>;
type SystemTenant = Awaited<ReturnType<typeof tenant.startSystem>>;
export type SummaryEmailDeps = Pick<
  typeof summaryEmailRepository,
  | "readCandidate"
  | "pushState"
  | "saveEnvelope"
  | "claim"
  | "finish"
  | "skip"
  | "closeExpired"
> & {
  withSystemTenant: SystemTenant["withSystemTenant"];
  now(): Date;
  publicOrigin: string;
  readScopedCompany(tx: TenantTx): Promise<{
    name: string;
    slug: string;
    timezone: string;
  }>;
  readRecipientEmail(tx: TenantTx, userId: string): Promise<string | null>;
  canReceiveCompanyNotification(tx: TenantTx, userId: string): Promise<boolean>;
  isActiveSummaryRecipient(
    tx: TenantTx,
    type: "daily" | "weekly",
    userId: string,
  ): Promise<boolean>;
  mailCodec: Pick<
    ReturnType<typeof createMailCodec>,
    "encryptMessage" | "decryptMessage"
  >;
  sendEmail: ReturnType<typeof createEmailSender>["sendEmail"];
  renderDaily(input: {
    company: string;
    url: string;
    data: DailyData;
  }): Omit<EmailMessage, "to">;
  renderWeekly(input: {
    company: string;
    url: string;
    data: WeeklyData;
  }): Omit<EmailMessage, "to">;
};

const summaryEmail = {
  create(deps: SummaryEmailDeps) {
    return {
      async deliver(
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
        const key = `summary:${job.companyId}:${job.notificationId}`;
        try {
          if (
            !(await run((tx) =>
              summaryEmail._prepare(deps, tx, job.notificationId, key),
            ))
          )
            return;
        } catch (error) {
          if (error instanceof AppError && error.code === "not_found") return;
          throw error;
        }
        control.signal.throwIfAborted();
        const claimed = await run((tx) =>
          summaryEmail._claim(deps, tx, job.notificationId, key),
        );
        if (!claimed) return;
        const remaining = claimed.stopAt.getTime() - deps.now().getTime();
        if (remaining <= 0) {
          await run((tx) =>
            deps.closeExpired(tx, job.notificationId, deps.now()),
          );
          return;
        }
        let sent = false;
        try {
          await deps.sendEmail({
            ...claimed.message,
            deliveryKey: key,
            signal: AbortSignal.any([
              control.signal,
              AbortSignal.timeout(remaining),
            ]),
          });
          sent = true;
        } finally {
          await run((tx) =>
            deps.finish(tx, {
              id: claimed.id,
              notificationId: job.notificationId,
              attempts: claimed.attempts,
              sent,
              at: deps.now(),
            }),
          );
        }
      },
    };
  },

  _data(row: Candidate): SummaryData | null {
    if (row.type === "daily" && row.data.type === "daily")
      return row.data as DailyData;
    if (row.type === "weekly" && row.data.type === "weekly")
      return row.data as WeeklyData;
    return null;
  },

  _eligible(
    row: Candidate,
    data: SummaryData,
    at: Date,
    timezone: string,
  ): boolean {
    if (at >= delivery._expiresAt(row, timezone)) return false;
    if (data.type === "daily")
      return dates.localDate(at, timezone) === data.localDate;
    return (
      dates.previousLocalWeekBounds(at, timezone).weekStart === data.weekStart
    );
  },

  async _prepare(
    deps: SummaryEmailDeps,
    tx: TenantTx,
    notificationId: string,
    key: string,
  ): Promise<boolean> {
    const row = await deps.readCandidate(tx, notificationId);
    if (!row) {
      await deps.skip(tx, notificationId, deps.now());
      return false;
    }
    const data = summaryEmail._data(row);
    if (!data) return false;
    const at = deps.now();
    const company = await deps.readScopedCompany(tx);
    if (!summaryEmail._eligible(row, data, at, company.timezone)) {
      await deps.closeExpired(tx, row.id, at);
      return false;
    }
    const push = await deps.pushState(tx, row.id);
    if (push.open) throw new Error("Push delivery is still open");
    if (
      row.pushedAt ||
      push.sent ||
      row.emailedAt ||
      !(await deps.canReceiveCompanyNotification(tx, row.userId)) ||
      !(await deps.isActiveSummaryRecipient(tx, data.type, row.userId))
    ) {
      await deps.skip(tx, row.id, at);
      return false;
    }
    const email = await deps.readRecipientEmail(tx, row.userId);
    if (!email) {
      await deps.skip(tx, row.id, at);
      return false;
    }
    const expected = `/${company.slug}/${data.type === "daily" ? "today" : "notifications"}`;
    if (row.url !== expected) throw new Error("Summary link is not valid");
    const url = new URL(row.url, deps.publicOrigin).href;
    const rendered =
      data.type === "daily"
        ? deps.renderDaily({ company: company.name, url, data })
        : deps.renderWeekly({ company: company.name, url, data });
    await deps.saveEnvelope(tx, {
      companyId: row.companyId,
      notificationId: row.id,
      encryptedMessage: deps.mailCodec.encryptMessage(
        { ...rendered, to: email },
        key,
      ),
      expiresAt: delivery._expiresAt(row, company.timezone),
      at,
    });
    return true;
  },

  async _claim(
    deps: SummaryEmailDeps,
    tx: TenantTx,
    notificationId: string,
    key: string,
  ) {
    const row = await deps.readCandidate(tx, notificationId);
    if (!row) {
      await deps.skip(tx, notificationId, deps.now());
      return null;
    }
    const data = summaryEmail._data(row);
    const at = deps.now();
    const company = await deps.readScopedCompany(tx);
    if (data && !summaryEmail._eligible(row, data, at, company.timezone)) {
      await deps.closeExpired(tx, row.id, at);
      return null;
    }
    const push = await deps.pushState(tx, row.id);
    if (push.open) throw new Error("Push delivery is still open");
    if (
      !data ||
      row.pushedAt ||
      push.sent ||
      row.emailedAt ||
      !(await deps.canReceiveCompanyNotification(tx, row.userId)) ||
      !(await deps.isActiveSummaryRecipient(tx, data.type, row.userId))
    ) {
      await deps.skip(tx, row.id, at);
      return null;
    }
    const claim = await deps.claim(tx, row.id, at);
    if (!claim) return null;
    if (!claim.encryptedMessage)
      throw new Error("Summary email envelope is missing");
    const message = deps.mailCodec.decryptMessage(claim.encryptedMessage, key);
    const email = await deps.readRecipientEmail(tx, row.userId);
    if (message.to !== email) {
      await deps.skip(tx, row.id, at);
      return null;
    }
    return { ...claim, message };
  },
};
export type SummaryEmailService = ReturnType<typeof summaryEmail.create>;
export default summaryEmail;
