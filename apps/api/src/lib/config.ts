function secret(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim() ?? "";
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value)
    throw new Error(`${name} must be 32 bytes in base64`);
  return value;
}

export function loadMailKey(env: NodeJS.ProcessEnv = process.env): string {
  return secret("MAIL_ENCRYPTION_KEY", env);
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const mailKey = loadMailKey(env);
  const otpPepper = secret("OTP_PEPPER", env);
  if (mailKey === otpPepper)
    throw new Error("OTP_PEPPER and MAIL_ENCRYPTION_KEY must differ");
  const publicOrigin = env.PUBLIC_ORIGIN ?? "";
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
  if (env.ANAR_LOCAL_HTTP && !["true", "false"].includes(env.ANAR_LOCAL_HTTP))
    throw new Error("ANAR_LOCAL_HTTP must be true or false");
  const localHttp = env.ANAR_LOCAL_HTTP === "true";
  if ((origin.protocol === "http:") !== localHttp)
    throw new Error(
      "HTTP origins require explicit ANAR_LOCAL_HTTP=true; otherwise use HTTPS",
    );
  const cookieTransport = localHttp
    ? { protocol: "http" as const, local: true as const }
    : { protocol: "https" as const };
  const proxies =
    env.TRUSTED_PROXY_CIDRS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  return {
    connectionString,
    mailKey,
    otpPepper,
    publicOrigin,
    trustProxy: proxies.length ? proxies : (false as const),
    cookieTransport,
  };
}
