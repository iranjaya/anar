import { overdueScanJobSchema } from "@anar/domain/jobs";
import { withScheduledJob } from "../lib/jobs/index.js";
import { createOverdueScanService } from "../modules/followups/index.js";
import periods from "../modules/followups/periods.js";
import { listDueFollowUps } from "../modules/leads/index.js";
import notifications from "../modules/notifications/service.js";
import { queueSummaryEmail } from "../modules/notifications/summaryEmailQueue.js";
import tenant from "../modules/tenant/index.js";
import recipients from "../modules/tenant/recipients.js";
import scheduler from "../modules/tenant/scheduler.js";

const unavailable = async (): Promise<never> => {
  throw new Error("No request context in overdue scan");
};

export async function startOverdueJob(options: {
  connectionString: string;
  pushEnabled: boolean;
}) {
  const system = await tenant.startSystem(options.connectionString);
  let catalog: Awaited<ReturnType<typeof scheduler.start>>;
  try {
    catalog = await scheduler.start(options.connectionString);
  } catch (error) {
    await system.close();
    throw error;
  }
  const notifier = notifications.create({
    context: { requireContext: unavailable, withContext: unavailable },
    now: () => new Date(),
    ...recipients,
    queueSummaryEmail,
    pushEnabled: options.pushEnabled,
    pushHosts: [],
    vapidPublicKey: "",
    bindPushEndpoint: unavailable,
  });
  const service = createOverdueScanService({
    now: () => new Date(),
    withSystemTenant: system.withSystemTenant,
    readScopedCompanyTimezone: recipients.readScopedCompanyTimezone,
    readScopedCompanySlug: recipients.readScopedCompanySlug,
    openPeriod: periods.openPeriod,
    checkpointPeriod: periods.checkpointPeriod,
    listDueFollowUps,
    hasNotification: periods.hasNotification,
    canReceiveCompanyNotification: recipients.canReceiveCompanyNotification,
    notify: notifier.notify,
  });
  return {
    job: {
      name: "followups.overdue_scan",
      run: (job: Parameters<typeof withScheduledJob>[0]) =>
        withScheduledJob(job, overdueScanJobSchema, service.scan),
    },
    async tick(now = new Date()): Promise<void> {
      const slot = new Date(
        Math.floor(now.getTime() / 1_800_000) * 1_800_000,
      ).toISOString();
      await catalog.enqueueOverdue(slot);
    },
    async close() {
      try {
        await catalog.close();
      } finally {
        await system.close();
      }
    },
  };
}
