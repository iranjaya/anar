import { createECDH, randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function createServerEnv(target: string): Promise<string[]> {
  if (!path.isAbsolute(target))
    throw new Error("Use an absolute production env path");
  const parent = path.dirname(target);
  if (
    path.basename(parent) !== "shared" ||
    path.basename(target) !== "production.env"
  )
    throw new Error("Use a shared/production.env target");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const vapid = createECDH("prime256v1");
  const publicKey = vapid.generateKeys().toString("base64url");
  const privateKey = vapid.getPrivateKey();
  const values = {
    ANAR_ENV: "production",
    POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
    APP_DATABASE_PASSWORD: randomBytes(32).toString("hex"),
    MIGRATION_DATABASE_PASSWORD: randomBytes(32).toString("hex"),
    DATABASE_URL: "",
    MIGRATION_DATABASE_URL: "",
    MAIL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    OTP_PEPPER: randomBytes(32).toString("base64"),
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: Buffer.concat([
      Buffer.alloc(32 - privateKey.length),
      privateKey,
    ]).toString("base64url"),
    VAPID_SUBJECT: "mailto:info@visitshankhuwasabha.com",
    PUBLIC_ORIGIN: "https://anar.visitshankhuwasabha.com",
    ANAR_LOCAL_HTTP: "false",
    ANAR_DATA_MODE: "real",
    ANAR_AUTH_ENABLED: "true",
    ANAR_PUSH_ENABLED: "false",
    EMAIL_TRANSPORT: "resend",
    EMAIL_FROM: "info@visitshankhuwasabha.com",
    EMAIL_REPLY_TO: "info@visitshankhuwasabha.com",
    RESEND_API_KEY: "",
    TRUSTED_PROXY_CIDRS: "",
  };
  values.DATABASE_URL = `postgresql://anar_app:${values.APP_DATABASE_PASSWORD}@db:5432/anar`;
  values.MIGRATION_DATABASE_URL = `postgresql://anar_migrate:${values.MIGRATION_DATABASE_PASSWORD}@db:5432/anar`;
  await writeFile(
    target,
    `${Object.entries(values)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n")}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return Object.keys(values);
}

if (import.meta.main) {
  try {
    const target = process.argv[2];
    if (!target) throw new Error("Production env target is required");
    for (const name of await createServerEnv(target)) console.log(name);
  } catch {
    console.error(
      "Server env generation failed; existing files are never replaced",
    );
    process.exitCode = 1;
  }
}
