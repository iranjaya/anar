import { type EmailMessage, emailMessageSchema } from "@anar/domain/jobs";
import { type EmailConfig, loadEmailConfig } from "./config.js";

export type { EmailConfig } from "./config.js";

export function createEmailSender(config: EmailConfig = loadEmailConfig()) {
  return {
    async sendEmail(
      input: EmailMessage & { deliveryKey: string; signal?: AbortSignal },
    ): Promise<void> {
      try {
        const message = emailMessageSchema.parse({
          to: input.to,
          subject: input.subject,
          text: input.text,
        });
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        let url: string | URL;
        let body: object;
        if (config.provider === "mailpit") {
          url = new URL("/api/v1/send", config.url);
          body = {
            From: { Email: config.from },
            To: [{ Email: message.to }],
            Subject: message.subject,
            Text: message.text,
            Headers: { "X-Anar-Delivery-Key": input.deliveryKey },
          };
        } else {
          url = config.url ?? "https://api.resend.com/emails";
          headers.Authorization = `Bearer ${config.apiKey}`;
          headers["Idempotency-Key"] = input.deliveryKey;
          body = {
            from: config.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
          };
        }
        const timeout = AbortSignal.timeout(10000);
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          redirect: "error",
          signal: input.signal
            ? AbortSignal.any([input.signal, timeout])
            : timeout,
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error("Email provider refused delivery");
      } catch {
        throw new Error("Email delivery failed");
      }
    },
  };
}
