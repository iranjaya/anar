import type { QueueJob, QueueRuntime } from "../lib/jobs/index.js";
import agencies from "../modules/agencies/service.js";
import companies from "../modules/companies/service.js";

export {
  loadMailKey,
  loadPushConfig,
  loadPushDeliveryConfig,
  loadUploadsRoot,
} from "../lib/config.js";
export { loadEmailConfig } from "../lib/email/config.js";
export { createMailCodec } from "../lib/email/crypto.js";
export { createEmailSender, type EmailConfig } from "../lib/email/index.js";
export {
  type ImportJobState,
  readImportJobState,
} from "../lib/jobs/index.js";
export { default as emailJob } from "../modules/auth/emailJob.js";
export { default as pushBindings } from "../modules/auth/pushBindings.js";
export { default as pushDelivery } from "../modules/notifications/delivery.js";
export { default as push } from "../modules/notifications/push.js";
export {
  type DeliverPush,
  default as pushJob,
} from "../modules/notifications/pushJob.js";
export { queueSummaryEmail } from "../modules/notifications/summaryEmailQueue.js";
export { default as recipients } from "../modules/tenant/recipients.js";
export { startImportJob } from "./imports.js";
export { startOverdueJob } from "./overdue.js";
export { startSummaryJob } from "./summaries.js";
export { startSummaryEmailJob } from "./summaryEmail.js";
export const readInitialInviteAgency = agencies.readInitialInviteAgency;
export const readStaffInviteAgency = agencies.readStaffInviteAgency;
export const readCompanyInviteTarget = companies.readCompanyInviteTarget;

export type JobRegistration = {
  name: string;
  run(job: QueueJob): Promise<void>;
};
export type JobDeps = {
  queue: Pick<QueueRuntime, "register">;
  jobs: readonly JobRegistration[];
};

export async function registerJobs(deps: JobDeps): Promise<void> {
  for (const job of deps.jobs) await deps.queue.register(job.name, job.run);
}
