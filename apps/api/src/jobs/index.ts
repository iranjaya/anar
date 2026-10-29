import type { QueueJob, QueueRuntime } from "../lib/jobs/index.js";

export { loadMailKey } from "../lib/config.js";
export { loadEmailConfig } from "../lib/email/config.js";
export { createMailCodec } from "../lib/email/crypto.js";
export { createEmailSender, type EmailConfig } from "../lib/email/index.js";
export { default as emailJob } from "../modules/auth/emailJob.js";

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
