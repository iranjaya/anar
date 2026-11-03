import { z } from "zod";

export type JobPayload = {
  kind: "otp" | "invite";
  referenceId: string;
  expiresAt: string;
  encryptedMessage: string;
};

export const notificationDeliveryJobSchema = z.strictObject({
  agencyId: z.uuid(),
  companyId: z.uuid(),
  notificationId: z.uuid(),
});
export type NotificationDeliveryJob = z.infer<
  typeof notificationDeliveryJobSchema
>;

export const importCommitJobSchema = z.strictObject({
  agencyId: z.uuid(),
  companyId: z.uuid(),
  actorUserId: z.uuid(),
  batchId: z.uuid(),
  runId: z.uuid(),
});
export type ImportCommitJob = z.infer<typeof importCommitJobSchema>;
export const overdueScanJobSchema = z.strictObject({
  agencyId: z.uuid(),
  companyId: z.uuid(),
  slot: z.iso.datetime({ offset: false }),
});
export type OverdueScanJob = z.infer<typeof overdueScanJobSchema>;
export const summaryJobSchema = z.strictObject({
  agencyId: z.uuid(),
  companyId: z.uuid(),
  period: z.enum(["daily", "weekly"]),
  localDate: z.iso.date(),
});
export type SummaryJob = z.infer<typeof summaryJobSchema>;

export type JobPayloads = {
  "notify.email": JobPayload;
  "notify.push": NotificationDeliveryJob;
  "notify.summary_email": NotificationDeliveryJob;
  "import.commit": ImportCommitJob;
  "followups.overdue_scan": OverdueScanJob;
  "reports.summary": SummaryJob;
};
export type JobName = keyof JobPayloads;

export const emailMessageSchema = z.strictObject({
  to: z.email(),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().min(1),
});
export type EmailMessage = z.infer<typeof emailMessageSchema>;
