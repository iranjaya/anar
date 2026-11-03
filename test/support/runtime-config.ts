import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

export function createTestRuntimeConfig(databaseUrl: string) {
  return {
    DATABASE_URL: databaseUrl,
    APP_DATABASE_URL: "",
    MIGRATION_DATABASE_URL: "",
    MAIL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    OTP_PEPPER: randomBytes(32).toString("base64"),
    PUBLIC_ORIGIN: "http://anar.example.test",
    ANAR_LOCAL_HTTP: "true",
    TRUSTED_PROXY_CIDRS: "",
    NODE_OPTIONS: "",
    HOST: "127.0.0.1",
    UPLOADS_ROOT: path.join(tmpdir(), "anar-test-uploads"),
  };
}
