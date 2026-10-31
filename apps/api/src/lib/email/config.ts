export type EmailConfig = (
  | { provider: "mailpit"; url: string }
  | { provider: "resend"; apiKey: string; url?: string }
) & { from: string; replyTo?: string };

export function loadEmailConfig(
  env: NodeJS.ProcessEnv = process.env,
): EmailConfig {
  const from = env.EMAIL_FROM?.trim();
  if (!from) throw new Error("EMAIL_FROM is required");
  const replyTo = env.EMAIL_REPLY_TO?.trim() || undefined;
  if (env.EMAIL_TRANSPORT === "mailpit") {
    const url = env.MAILPIT_URL?.trim();
    if (!url) throw new Error("MAILPIT_URL is required");
    return { provider: "mailpit", url, from, replyTo };
  }
  if (env.EMAIL_TRANSPORT === "resend") {
    const apiKey = env.RESEND_API_KEY?.trim();
    if (!apiKey) throw new Error("RESEND_API_KEY is required");
    return { provider: "resend", apiKey, from, replyTo };
  }
  throw new Error("EMAIL_TRANSPORT must be mailpit or resend");
}
