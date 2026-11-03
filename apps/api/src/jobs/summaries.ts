import { summaryJobSchema } from "@anar/domain/jobs";
import { withScheduledJob } from "../lib/jobs/index.js";
import summaryReads from "../modules/leads/summaryReads.js";
import notificationRepository from "../modules/notifications/repository.js";
import notifications from "../modules/notifications/service.js";
import { queueSummaryEmail } from "../modules/notifications/summaryEmailQueue.js";
import {
  createSummaryService,
  summaryRepository,
} from "../modules/reports/index.js";
import tenant from "../modules/tenant/index.js";
import recipients from "../modules/tenant/recipients.js";
import scheduler from "../modules/tenant/scheduler.js";

const unavailable = async (): Promise<never> => {
  throw new Error("No request context in summary job");
};

export async function startSummaryJob(options: {
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
  const service = createSummaryService({
    now: () => new Date(),
    withSystemTenant: system.withSystemTenant,
    ...summaryRepository,
    ...summaryReads,
    readScopedCompanyTimezone: recipients.readScopedCompanyTimezone,
    readScopedCompanySlug: recipients.readScopedCompanySlug,
    hasNotification: async (tx, userId, dedupeKey) =>
      Boolean(await notificationRepository.readByKey(tx, userId, dedupeKey)),
    canReceiveCompanyNotification: recipients.canReceiveCompanyNotification,
    notify: notifier.notify,
  });
  return {
    job: {
      name: "reports.summary",
      run: (job: Parameters<typeof withScheduledJob>[0]) =>
        withScheduledJob(job, summaryJobSchema, service.run),
    },
    tick: (at = new Date()) => catalog.enqueueSummaries(at),
    async close() {
      try {
        await catalog.close();
      } finally {
        await system.close();
      }
    },
  };
}
