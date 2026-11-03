import { execFile } from "node:child_process";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
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
const managerEmail = "manager@browser.example.test";
const companyStaffEmail = "company-staff@browser.example.test";
const inviteStaffEmail = "invite-staff@browser.example.test";
const superAdminStaffEmail = "super-admin-staff@browser.example.test";
const removerEmail = "remover@browser.example.test";
const leaverEmail = "leaver@browser.example.test";
const entriesManagerEmail = "entries-manager@browser.example.test";

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

// A throwaway CA lets the stack's worker trust the fake push services over HTTPS.
async function fakePushFiles(dir: string) {
  const openssl = (...args: string[]) =>
    run("openssl", args, { cwd: dir, timeout: 30000 });
  await run("mkdir", ["-p", dir]);
  await openssl(
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-days",
    "1",
    "-subj",
    "/CN=anar-test-push-ca",
  );
  await openssl(
    "req",
    "-new",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=fcm.googleapis.com",
    "-addext",
    "subjectAltName=DNS:fcm.googleapis.com,DNS:web.push.apple.com",
  );
  await openssl(
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "server.pem",
    "-days",
    "1",
    "-copy_extensions",
    "copyall",
  );
  await copyFile(
    fileURLToPath(new URL("./fake-push-server.mjs", import.meta.url)),
    path.join(dir, "server.mjs"),
  );
  await run("chmod", ["-R", "a+rX", dir]);
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
  const vapid = createECDH("prime256v1");
  const vapidPublicKey = vapid.generateKeys().toString("base64url");
  const vapidPrivateKey = vapid.getPrivateKey().toString("base64url");
  const pushDir = path.join(dir, "fake-push");
  await fakePushFiles(pushDir);
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
    EMAIL_REPLY_TO: "support@browser.example.test",
    RESEND_API_KEY: "",
    ANAR_PUSH_ENABLED: "true",
    VAPID_PUBLIC_KEY: vapidPublicKey,
    VAPID_PRIVATE_KEY: vapidPrivateKey,
    VAPID_SUBJECT: "mailto:push@browser.example.test",
    FAKE_PUSH_DIR: pushDir,
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
        vapidPrivateKey,
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
    await compose("up", "--detach", "--wait", "db", "mailpit", "fake-push");
    await compose("run", "--rm", "migrate");
    await compose("run", "--rm", "migrate");
    await sql(`INSERT INTO users (id,email,name,platform_role) VALUES
      ('10000000-0000-4000-8000-000000000001','${ownerEmail}','Browser Owner','owner'),
      ('10000000-0000-4000-8000-000000000002','${staffEmail}','Browser Staff',NULL);
      INSERT INTO agencies (id,name,slug,status,created_by) VALUES
      ('20000000-0000-4000-8000-000000000001','Browser Agency','browser-agency','active','10000000-0000-4000-8000-000000000001');
      INSERT INTO agency_members (id,agency_id,user_id,status,invited_by) VALUES
      ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','active','10000000-0000-4000-8000-000000000001');
      INSERT INTO users (id,email,name) VALUES
      ('10000000-0000-4000-8000-000000000003','${managerEmail}','Browser Manager'),
      ('10000000-0000-4000-8000-000000000004','${companyStaffEmail}','Company Staff'),
      ('10000000-0000-4000-8000-000000000005','${inviteStaffEmail}','Invite Staff'),
      ('10000000-0000-4000-8000-000000000006','${superAdminStaffEmail}','Super Admin Staff'),
      ('10000000-0000-4000-8000-000000000007','${removerEmail}','Remover Staff'),
      ('10000000-0000-4000-8000-000000000008','${leaverEmail}','Leaver Staff'),
      ('10000000-0000-4000-8000-000000000009','${entriesManagerEmail}','Entries Manager');
      INSERT INTO agencies (id,name,slug,status,created_by) VALUES
      ('20000000-0000-4000-8000-000000000002','Other Agency','other-agency','active','10000000-0000-4000-8000-000000000001'),
      ('20000000-0000-4000-8000-000000000003','Removal Agency','removal-agency','active','10000000-0000-4000-8000-000000000001');
      INSERT INTO agency_members (id,agency_id,user_id,status,invited_by) VALUES
      ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','active','10000000-0000-4000-8000-000000000001'),
      ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','active','10000000-0000-4000-8000-000000000001'),
      ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000006','active','10000000-0000-4000-8000-000000000001'),
      ('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000007','active','10000000-0000-4000-8000-000000000001'),
      ('30000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000008','active','10000000-0000-4000-8000-000000000001');
      INSERT INTO companies (id,agency_id,name,slug,status,default_country,timezone) VALUES
      ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Browser Company','browser-company','active','NP','Asia/Kathmandu'),
      ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Other Company','other-company','active','NP','Asia/Kathmandu');
      INSERT INTO company_members (id,agency_id,company_id,user_id,name,role,status) VALUES
      ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','Browser Manager','super_admin','active'),
      ('50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000009','Entries Manager','super_admin','active');`);
    await compose("up", "--detach", "api", "worker", "web", "proxy");
    const pushURL = `http://${await compose("port", "fake-push", "8080")}`;
    const published = await compose("port", "mailpit", "8025");
    const mailURL = `http://${published}`;
    const httpsPort = (await compose("port", "proxy", "443")).split(":").pop();
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
    return { baseURL, mailURL, httpsPort, pushURL, project, close };
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
      JSON.stringify({
        baseURL: stack.baseURL,
        mailURL: stack.mailURL,
        httpsPort: stack.httpsPort,
        pushURL: stack.pushURL,
        project: stack.project,
      }),
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
