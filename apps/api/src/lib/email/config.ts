export type EmailConfig =
  | { provider: "mailpit"; url: string; from: string }
  | { provider: "resend"; apiKey: string; from: string; url?: string };

export function loadEmailConfig(
  env: NodeJS.ProcessEnv = process.env,
): EmailConfig {
  const from = env.EMAIL_FROM?.trim();
  if (!from) throw new Error("EMAIL_FROM is required");
  if (env.EMAIL_TRANSPORT === "mailpit") {
    const url = env.MAILPIT_URL?.trim();
    if (!url) throw new Error("MAILPIT_URL is required");
    return { provider: "mailpit", url, from };
  }
  if (env.EMAIL_TRANSPORT === "resend") {
    const apiKey = env.RESEND_API_KEY?.trim();
    if (!apiKey) throw new Error("RESEND_API_KEY is required");
    return { provider: "resend", apiKey, from };
  }
  throw new Error("EMAIL_TRANSPORT must be mailpit or resend");
}
