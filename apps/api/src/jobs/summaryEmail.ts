import { notificationDeliveryJobSchema } from "@anar/domain/jobs";
import { loadMailKey } from "../lib/config.js";
import { createMailCodec } from "../lib/email/crypto.js";
import { createEmailSender } from "../lib/email/index.js";
import dailySummary from "../lib/email/templates/dailySummary.js";
import weeklySummary from "../lib/email/templates/weeklySummary.js";
import { withScheduledJob } from "../lib/jobs/index.js";
import summaryEmail from "../modules/notifications/summaryEmail.js";
import summaryEmailRepository from "../modules/notifications/summaryEmailRepository.js";
import summaryRepository from "../modules/reports/summaryRepository.js";
import tenant from "../modules/tenant/index.js";
import recipients from "../modules/tenant/recipients.js";

export async function startSummaryEmailJob(connectionString: string) {
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? "";
  let origin: URL;
  try {
    origin = new URL(publicOrigin);
  } catch {
    throw new Error("PUBLIC_ORIGIN must be an exact HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== publicOrigin
  )
    throw new Error("PUBLIC_ORIGIN must be an exact HTTP(S) origin");
  const mailCodec = createMailCodec(loadMailKey());
  const sender = createEmailSender();
  const system = await tenant.startSystem(connectionString);
  const service = summaryEmail.create({
    ...summaryEmailRepository,
    withSystemTenant: system.withSystemTenant,
    now: () => new Date(),
    publicOrigin,
    readScopedCompany: recipients.readScopedCompany,
    readRecipientEmail: recipients.readRecipientEmail,
    canReceiveCompanyNotification: recipients.canReceiveCompanyNotification,
    isActiveSummaryRecipient: (tx, type, userId) =>
      type === "daily"
        ? summaryRepository.isActiveAdmin(tx, userId)
        : summaryRepository.isActiveManager(tx, userId),
    mailCodec,
    sendEmail: sender.sendEmail,
    renderDaily: dailySummary.render,
    renderWeekly: weeklySummary.render,
  });
  return {
    job: {
      name: "notify.summary_email",
      run: (job: Parameters<typeof withScheduledJob>[0]) =>
        withScheduledJob(job, notificationDeliveryJobSchema, service.deliver),
    },
    close: system.close,
  };
}
