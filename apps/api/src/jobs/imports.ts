import { AppError } from "@anar/domain/errors";
import {
  type ImportRunnerDeps,
  importCommitJob,
} from "../modules/imports/index.js";
import { addImportedLeads } from "../modules/leads/index.js";
import members from "../modules/members/service.js";
import notifications from "../modules/notifications/service.js";
import { queueSummaryEmail } from "../modules/notifications/summaryEmailQueue.js";
import { loadActiveConfig, scoreLead } from "../modules/scoring/index.js";
import { loadSchema } from "../modules/settings/index.js";
import { importJobs } from "../modules/tenant/index.js";
import recipients from "../modules/tenant/recipients.js";

// Jobs never serve HTTP, so the request context and push subscription paths refuse.
const noRequest = async (): Promise<never> => {
  throw new AppError("unavailable", "Not available in a background job");
};

export async function startImportJob(options: {
  connectionString: string;
  uploadsRoot: string;
  pushEnabled: boolean;
}) {
  const runner = await importJobs.start(options.connectionString);
  const notifier = notifications.create({
    context: { requireContext: noRequest, withContext: noRequest },
    now: () => new Date(),
    ...recipients,
    queueSummaryEmail,
    pushEnabled: options.pushEnabled,
    pushHosts: [],
    vapidPublicKey: "",
    bindPushEndpoint: noRequest,
  });
  const deps: ImportRunnerDeps = {
    uploadsRoot: options.uploadsRoot,
    loadSchema,
    loadActiveConfig,
    scoreLead,
    addImportedLeads,
    notify: notifier.notify,
    readScopedCompanySlug: recipients.readScopedCompanySlug,
    canReceiveCompanyNotification: recipients.canReceiveCompanyNotification,
    listSuperAdminUserIds: members.listSuperAdminUserIds,
    withImportJob: runner.withImportJob,
    withImportRecord: runner.withImportRecord,
  };
  return { job: importCommitJob.create(deps), close: runner.close };
}
