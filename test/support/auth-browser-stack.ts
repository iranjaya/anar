import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const composeFile = fileURLToPath(
  new URL("../../apps/web/e2e-auth/compose.yml", import.meta.url),
);
const ownerEmail = "owner@browser.example.test";
const staffEmail = "staff@browser.example.test";

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string")
    throw new Error("Expected a browser test port");
  return address.port;
}

async function waitFor(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await delay(250);
  }
  throw new Error(`Browser fixture timed out: ${label}`);
}

async function startAuthStack(signal: AbortSignal) {
  const project = `anar-browser-${randomUUID()}`;
  const dir = await mkdtemp(path.join(tmpdir(), "anar-browser-"));
  const envFile = path.join(dir, "test.env");
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const appPassword = randomBytes(18).toString("hex");
  const migrationPassword = randomBytes(18).toString("hex");
  const values = {
    AUTH_TEST_PROJECT: project,
    AUTH_TEST_PORT: String(port),
    POSTGRES_DB: "anar",
    POSTGRES_USER: "postgres",
    POSTGRES_PASSWORD: randomBytes(18).toString("hex"),
    APP_DATABASE_PASSWORD: appPassword,
    MIGRATION_DATABASE_PASSWORD: migrationPassword,
    DATABASE_URL: `postgresql://anar_app:${appPassword}@db:5432/anar`,
    MIGRATION_DATABASE_URL: `postgresql://anar_migrate:${migrationPassword}@db:5432/anar`,
    OTP_PEPPER: randomBytes(32).toString("base64"),
    MAIL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    PUBLIC_ORIGIN: baseURL,
    ANAR_LOCAL_HTTP: "true",
    ANAR_AUTH_ENABLED: "true",
    TRUSTED_PROXY_CIDRS: "uniquelocal",
    EMAIL_TRANSPORT: "mailpit",
    EMAIL_FROM: "proof@browser.example.test",
    RESEND_API_KEY: "",
  };
  await writeFile(
    envFile,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    { mode: 0o600 },
  );
  const env: Record<string, string | undefined> = {};
  for (const key of [
    "PATH",
    "HOME",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "TMPDIR",
  ])
    if (process.env[key]) env[key] = process.env[key];
  const compose = async (...args: string[]) => {
    try {
      return (
        await run(
          "docker",
          [
            "compose",
            "--env-file",
            envFile,
            "--project-name",
            project,
            "--file",
            composeFile,
            ...args,
          ],
          {
            env,
            timeout: 240000,
            maxBuffer: 8 * 1024 * 1024,
            signal: args[0] === "down" ? undefined : signal,
          },
        )
      ).stdout.trim();
    } catch (error) {
      let detail =
        error && typeof error === "object" && "stderr" in error
          ? String(error.stderr).slice(-3000)
          : "";
      for (const secret of [
        values.POSTGRES_PASSWORD,
        appPassword,
        migrationPassword,
        values.OTP_PEPPER,
        values.MAIL_ENCRYPTION_KEY,
      ])
        detail = detail.replaceAll(secret, "[redacted]");
      throw new Error(
        `Browser fixture Compose ${args[0]} failed (${project}): ${detail}`,
      );
    }
  };
  const sql = (query: string) =>
    compose(
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "postgres",
      "-d",
      "anar",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      query,
    );
  const close = async () => {
    try {
      await compose("down", "--volumes", "--remove-orphans");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  try {
    await compose("build", "migrate", "api", "worker", "web");
    await compose("up", "--detach", "--wait", "db", "mailpit");
    await compose("run", "--rm", "migrate");
    await compose("run", "--rm", "migrate");
    await sql(`INSERT INTO users (id,email,name,platform_role) VALUES
      ('10000000-0000-4000-8000-000000000001','${ownerEmail}','Browser Owner','owner'),
      ('10000000-0000-4000-8000-000000000002','${staffEmail}','Browser Staff',NULL);
      INSERT INTO agencies (id,name,slug,status,created_by) VALUES
      ('20000000-0000-4000-8000-000000000001','Browser Agency','browser-agency','active','10000000-0000-4000-8000-000000000001');
      INSERT INTO agency_members (id,agency_id,user_id,status,invited_by) VALUES
      ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','active','10000000-0000-4000-8000-000000000001');`);
    await compose("up", "--detach", "api", "worker", "web", "proxy");
    const published = await compose("port", "mailpit", "8025");
    const mailURL = `http://${published}`;
    await waitFor(async () => {
      const response = await fetch(`${baseURL}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      await response.body?.cancel();
      return response.ok;
    }, "API health");
    await waitFor(
      async () => (await sql("SELECT count(*) FROM worker_heartbeats")) !== "0",
      "worker heartbeat",
    );
    await waitFor(async () => {
      const response = await fetch(`${baseURL}/login`, {
        signal: AbortSignal.timeout(2000),
      });
      await response.body?.cancel();
      return response.ok;
    }, "web readiness");
    return { baseURL, mailURL, close };
  } catch (error) {
    await close();
    throw error;
  }
}

const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
process.stdin.once("end", stop);
process.stdin.resume();
try {
  const stack = await startAuthStack(controller.signal);
  try {
    console.log(
      JSON.stringify({ baseURL: stack.baseURL, mailURL: stack.mailURL }),
    );
    if (!controller.signal.aborted)
      await new Promise<void>((resolve) =>
        controller.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
  } finally {
    await stack.close();
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Browser fixture failed",
  );
  process.exitCode = 1;
} finally {
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
  process.stdin.destroy();
}
