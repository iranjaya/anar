import { z } from "zod";

export type JobName = "notify.email";

export type JobPayload = {
  kind: "otp" | "invite";
  referenceId: string;
  expiresAt: string;
  encryptedMessage: string;
};

export const emailMessageSchema = z.strictObject({
  to: z.email(),
  subject: z.string().min(1),
  text: z.string().min(1),
});
export type EmailMessage = z.infer<typeof emailMessageSchema>;
