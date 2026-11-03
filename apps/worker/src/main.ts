import {
  createEmailSender,
  createMailCodec,
  type DeliverPush,
  emailJob,
  type JobRegistration,
  loadMailKey,
  loadPushConfig,
  loadPushDeliveryConfig,
  loadUploadsRoot,
  push,
  pushBindings,
  pushDelivery,
  pushJob,
  queueSummaryEmail,
  readCompanyInviteTarget,
  readInitialInviteAgency,
  readStaffInviteAgency,
  recipients,
  registerJobs,
  startImportJob,
  startOverdueJob,
  startSummaryEmailJob,
  startSummaryJob,
} from "@anar/api/jobs";
import { createQueueRuntime } from "@anar/db/queue";
import { v7 } from "uuid";

export type WorkerOptions = {
  databaseUrl?: string;
  jobs?: readonly JobRegistration[];
  deliverPush?: DeliverPush;
};

export async function startWorker(
  signal: AbortSignal,
  options: WorkerOptions = {},
): Promise<void> {
  if (signal.aborted) return;
  const url = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const failed = new AbortController();
  const stopped = AbortSignal.any([signal, failed.signal]);
  let failure: Error | undefined;
  const fail = () => {
    failure ??= new Error("Worker queue failed");
    failed.abort();
  };
  let jobs = options.jobs;
  let closeEmail: (() => Promise<void>) | undefined;
  let closePush: (() => Promise<void>) | undefined;
  let closeImports: (() => Promise<void>) | undefined;
  let overdue: Awaited<ReturnType<typeof startOverdueJob>> | undefined;
  let summaries: Awaited<ReturnType<typeof startSummaryJob>> | undefined;
  let summaryEmail:
    | Awaited<ReturnType<typeof startSummaryEmailJob>>
    | undefined;
  if (jobs === undefined) {
    const delivery = await emailJob.start({
      connectionString: url,
      mailCodec: createMailCodec(loadMailKey()),
      sendEmail: createEmailSender().sendEmail,
      now: () => new Date(),
      readInitialInviteAgency,
      readStaffInviteAgency,
      readCompanyInviteTarget,
    });
    jobs = [delivery.job];
    closeEmail = delivery.close;
    try {
      const imports = await startImportJob({
        connectionString: url,
        uploadsRoot: loadUploadsRoot(),
        pushEnabled: loadPushConfig().pushEnabled,
      });
      jobs = [...jobs, imports.job];
      closeImports = imports.close;
      overdue = await startOverdueJob({
        connectionString: url,
        pushEnabled: loadPushConfig().pushEnabled,
      });
      jobs = [...jobs, overdue.job];
      summaries = await startSummaryJob({
        connectionString: url,
        pushEnabled: loadPushConfig().pushEnabled,
      });
      jobs = [...jobs, summaries.job];
      summaryEmail = await startSummaryEmailJob(url);
      jobs = [...jobs, summaryEmail.job];
    } catch (error) {
      await summaryEmail?.close();
      await summaries?.close();
      await overdue?.close();
      await closeImports?.();
      await closeEmail();
      throw error;
    }
    if (loadPushConfig().pushEnabled) {
      let deliverPush = options.deliverPush;
      if (!deliverPush) {
        try {
          const started = await pushDelivery.start({
            connectionString: url,
            now: () => new Date(),
            sendPush: push.createSender(loadPushDeliveryConfig()),
            canReceiveCompanyNotification:
              recipients.canReceiveCompanyNotification,
            isScopedCompanyMember: recipients.isScopedCompanyMember,
            readScopedCompanyTimezone: recipients.readScopedCompanyTimezone,
            readLivePushBinding: pushBindings.readLivePushBinding,
            queueSummaryEmail,
          });
          deliverPush = started.service.deliverPush;
          closePush = started.close;
        } catch (error) {
          await summaryEmail?.close();
          await summaries?.close();
          await closeImports?.();
          await overdue?.close();
          await closeEmail();
          throw error;
        }
      }
      jobs = [...jobs, pushJob.create(deliverPush)];
    }
  }
  try {
    const runtime = await createQueueRuntime(url, fail);
    const workerId = v7();
    const startedAt = new Date();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let beating = Promise.resolve();
    let scanning = Promise.resolve();
    let scanTimer: ReturnType<typeof setTimeout> | undefined;
    let summarizing = Promise.resolve();
    let summaryTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleHeartbeat = () => {
      if (stopped.aborted) return;
      timer = setTimeout(() => {
        beating = runtime
          .heartbeat(workerId, startedAt)
          .catch(fail)
          .then(scheduleHeartbeat);
      }, 30000);
    };
    const scheduleOverdue = () => {
      const scan = overdue;
      if (stopped.aborted || !scan) return;
      const delay = 1_800_000 - (Date.now() % 1_800_000);
      scanTimer = setTimeout(() => {
        scanning = scan.tick().catch(fail).then(scheduleOverdue);
      }, delay);
    };
    const scheduleSummaries = () => {
      const run = summaries;
      if (stopped.aborted || !run) return;
      const delay = 300_000 - (Date.now() % 300_000);
      summaryTimer = setTimeout(() => {
        summarizing = run.tick().catch(fail).then(scheduleSummaries);
      }, delay);
    };
    try {
      if (!stopped.aborted) {
        await registerJobs({ queue: runtime, jobs });
        if (!stopped.aborted) {
          await runtime.heartbeat(workerId, startedAt);
          scheduleHeartbeat();
          if (overdue) {
            scanning = overdue.tick().catch(fail).then(scheduleOverdue);
          }
          if (summaries) {
            summarizing = summaries.tick().catch(fail).then(scheduleSummaries);
          }
          await new Promise<void>((resolve) => {
            if (stopped.aborted) resolve();
            else
              stopped.addEventListener("abort", () => resolve(), {
                once: true,
              });
          });
        }
      }
    } finally {
      clearTimeout(timer);
      clearTimeout(scanTimer);
      clearTimeout(summaryTimer);
      await beating;
      await scanning;
      await summarizing;
      await runtime.close();
    }
    if (failure) throw failure;
  } finally {
    try {
      await closePush?.();
      await closeImports?.();
      await overdue?.close();
      await summaries?.close();
      await summaryEmail?.close();
    } finally {
      await closeEmail?.();
    }
  }
}

if (import.meta.main) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await startWorker(controller.signal);
  } catch {
    console.error("Worker stopped after a runtime failure");
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
