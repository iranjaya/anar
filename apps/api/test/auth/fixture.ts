import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  authRateLimits,
  createPlatformDb,
  otpCodes,
  type PlatformTx,
  sessions,
  users,
} from "@anar/db/platform";
import type { AuthUser } from "@anar/domain/auth";
import type { JobPayload } from "@anar/domain/jobs";
import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { v7 } from "uuid";
import { expect } from "vitest";
import { startMailpit } from "../../../../test/support/mailpit.js";
import { startPostgres } from "../../../../test/support/postgres.js";
import { buildApp } from "../../src/app.js";
import { createMailCodec } from "../../src/lib/email/crypto.js";
import stepUpCode from "../../src/lib/email/templates/stepUpCode.js";
import { originGuard } from "../../src/lib/http.js";
import agencies from "../../src/modules/agencies/service.js";
import bootstrap from "../../src/modules/auth/bootstrap.js";
import type { CookieTransport } from "../../src/modules/auth/cookies.js";
import inviteAcceptance from "../../src/modules/auth/inviteAcceptance.js";
import invites from "../../src/modules/auth/invites.js";
import otp from "../../src/modules/auth/otp.js";
import type { SessionService } from "../../src/modules/auth/sessions.js";

const run = promisify(execFile);
export const publicOrigin = "http://anar.example.test";
export type StoredJob = {
  id: string;
  data: JobPayload;
  state: string;
  key: string;
  output: unknown;
  retries: number;
};
type ApiInstance = {
  app: FastifyInstance;
  sessions: SessionService;
  close(): Promise<void>;
};
type ProofProcess = {
  child: ChildProcess;
  done: Promise<number | null>;
  stop(): Promise<number | null>;
};

export async function startAuthFixture() {
  const postgres = await startPostgres();
  let mailpit: Awaited<ReturnType<typeof startMailpit>> | undefined;
  let db: Awaited<ReturnType<typeof createPlatformDb>> | undefined;
  let time = Date.now();
  const now = () => new Date(time);
  const pepper = randomBytes(32).toString("base64");
  const mailKey = randomBytes(32).toString("base64");
  const codec = createMailCodec(mailKey);
  const apps: ApiInstance[] = [];
  const processes: ProofProcess[] = [];
  const processLogs: string[] = [];

  function launch(entry: URL, env: NodeJS.ProcessEnv): ProofProcess {
    const child = spawn(process.execPath, [fileURLToPath(entry)], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      output += error.message;
    });
    const done = new Promise<number | null>((resolve) =>
      child.once("close", (code) => {
        processLogs.push(output);
        resolve(code);
      }),
    );
    const running = {
      child,
      done,
      async stop() {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGTERM");
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            done,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                child.kill("SIGKILL");
                reject(new Error("Proof process did not stop"));
              }, 15000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      },
    };
    processes.push(running);
    return running;
  }

  async function addApp(
    transport: CookieTransport = { protocol: "http", local: true },
  ): Promise<ApiInstance> {
    if (!db) throw new Error("Proof database is not ready");
    const requester = await otp.start({
      connectionString: postgres.appUrl,
      otpPepper: pepper,
      mailCodec: codec,
      now,
    });
    let verifier: Awaited<ReturnType<typeof otp.startVerifier>> | undefined;
    try {
      verifier = await otp.startVerifier({
        connectionString: postgres.appUrl,
        otpPepper: pepper,
        cookieTransport: transport,
        now,
      });
      const verification = verifier;
      const app = buildApp({
        invites: inviteAcceptance.create({
          db,
          otpPepper: pepper,
          now,
          readInitialInviteAgency: agencies.readInitialInviteAgency,
          lockInitialInviteAgency: agencies.lockInitialInviteAgency,
          hasStaffMembership: agencies.hasStaffMembership,
          activateInvitedStaff: agencies.activateInvitedStaff,
        }),
        agencies: agencies.create({
          sessions: verification.sessions,
          createInitialInvite: invites.create({
            publicOrigin,
            mailCodec: codec,
            now,
          }).createInitialInvite,
          now,
        }),
        otp: requester.service,
        verifier: verification.service,
        sessions: verification.sessions,
        stepUp: requester.createStepUp({
          sessions: verification.sessions,
          renderCode: stepUpCode.render,
        }),
        requireOrigin: originGuard(publicOrigin),
        trustProxy: false,
      });
      await app.ready();
      const instance = {
        app,
        sessions: verification.sessions,
        async close() {
          try {
            await app.close();
          } finally {
            await Promise.all([requester.close(), verification.close()]);
          }
        },
      };
      apps.push(instance);
      return instance;
    } catch (error) {
      await Promise.all([requester.close(), verifier?.close()]);
      throw error;
    }
  }

  const stopProcesses = async () => {
    const codes = await Promise.all(
      processes.splice(0).map((running) => running.stop()),
    );
    for (const code of codes) expect(code).toBe(0);
  };
  const close = async () => {
    try {
      await stopProcesses();
    } finally {
      try {
        await Promise.all(apps.map((app) => app.close()));
      } finally {
        try {
          await db?.close();
        } finally {
          await Promise.all([mailpit?.stop(), postgres.stop()]);
          for (const name of [postgres.name, mailpit?.name].filter(
            (name) => name !== undefined,
          )) {
            expect(
              (
                await run("docker", [
                  "ps",
                  "-aq",
                  "--filter",
                  `name=^/${name}$`,
                ])
              ).stdout.trim(),
            ).toBe("");
          }
        }
      }
    }
  };
  try {
    for (let i = 0; i < 2; i++) {
      await postgres.bootstrap();
      await postgres.migrate();
    }
    mailpit = await startMailpit();
    db = await createPlatformDb(postgres.appUrl);
    const runtime = db;
    const mail = mailpit;
    await addApp();
    await addApp();
    const rows = <T extends Record<string, unknown>>(query: SQL) =>
      runtime.transaction(async (tx) => (await tx.execute<T>(query)).rows);
    const owner = (query: string) =>
      run("docker", [
        "exec",
        postgres.name,
        "psql",
        "-X",
        "-q",
        "-U",
        "anar_migrate",
        "-d",
        "anar_s04",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        query,
      ]);
    const jobs = () =>
      rows<StoredJob>(
        sql`select id, data, state, singleton_key as key, output, retry_count as retries from pgboss.job where name = 'notify.email' order by created_on, id`,
      );
    const post = (
      path: string,
      payload: unknown,
      options: {
        index?: number;
        ip?: string;
        origin?: string | null;
        cookie?: string;
      } = {},
    ): Promise<LightMyRequestResponse> =>
      apps[options.index ?? 0].app.inject({
        method: "POST",
        url: `/api/auth/${path}`,
        payload: JSON.stringify(payload),
        remoteAddress: options.ip ?? "198.51.100.10",
        headers: {
          "content-type": "application/json",
          "user-agent": "Auth proof device",
          ...(options.origin === null
            ? {}
            : { origin: options.origin ?? publicOrigin }),
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
      });
    const currentCode = async (userId: string) => {
      const [challenge] = await runtime.transaction((tx) =>
        tx
          .select()
          .from(otpCodes)
          .where(and(eq(otpCodes.userId, userId), isNull(otpCodes.consumedAt))),
      );
      if (!challenge) throw new Error("Expected an unconsumed proof challenge");
      const job = (await jobs()).find(
        (job) => job.data.referenceId === challenge.id,
      );
      if (!job) throw new Error("Expected a persisted OTP job");
      const message = codec.decryptMessage(job.data.encryptedMessage, job.key);
      const code = message.text.match(/\b\d{6}\b/)?.[0];
      if (!code) throw new Error("Expected a six-digit proof code");
      return { challenge, job, message, code };
    };
    const fixture = {
      postgres,
      mailpit: mail,
      db: runtime,
      apps,
      codec,
      now,
      rows,
      owner,
      jobs,
      post,
      currentCode,
      addApp,
      close,
      stopProcesses,
      processLogs,
      setTime(at: number) {
        time = at;
      },
      advance(ms: number) {
        time += ms;
      },
      async reset() {
        await stopProcesses();
        await owner(
          "TRUNCATE public.audit_log, public.otp_codes, public.sessions, public.auth_rate_limits, public.users CASCADE; TRUNCATE pgboss.job; TRUNCATE public.worker_heartbeats",
        );
        await mail.clear();
        time = Date.now();
      },
      async seedUser(email = `${v7()}@example.test`, owner = false) {
        if (owner)
          return bootstrap.bootstrapOwner(runtime, {
            environment: "proof",
            email,
            name: "Proof user",
          });
        const [user] = await runtime.transaction((tx) =>
          tx
            .insert(users)
            .values({
              id: v7(),
              email,
              name: "Proof user",
              platformRole: null,
            })
            .returning(),
        );
        return user;
      },
      limits: () =>
        runtime.transaction((tx) => tx.select().from(authRateLimits)),
      sessionRows: (userId: string) =>
        runtime.transaction((tx) =>
          tx.select().from(sessions).where(eq(sessions.userId, userId)),
        ),
      challenges: (userId: string) =>
        runtime.transaction((tx) =>
          tx.select().from(otpCodes).where(eq(otpCodes.userId, userId)),
        ),
      async login(
        options: { index?: number; ip?: string; owner?: boolean } = {},
      ) {
        const user = await fixture.seedUser(undefined, options.owner);
        return fixture.loginAs(user, options);
      },
      async loginAs(
        user: AuthUser,
        options: { index?: number; ip?: string } = {},
      ) {
        expect(
          (await post("requestOtp", { email: user.email }, options)).statusCode,
        ).toBe(200);
        const issued = await currentCode(user.id);
        const response = await post(
          "verifyOtp",
          { email: user.email, code: issued.code },
          options,
        );
        expect(response.statusCode).toBe(200);
        const header = response.headers["set-cookie"];
        if (typeof header !== "string")
          throw new Error("Expected one session cookie");
        return {
          user,
          ...issued,
          response,
          header,
          cookie: header.split(";")[0],
        };
      },
      async startWorker(url = mail.url) {
        const before = (
          await rows<{ count: number }>(
            sql`select count(*)::int as count from worker_heartbeats`,
          )
        )[0].count;
        const worker = launch(
          new URL("../../../worker/dist/main.js", import.meta.url),
          {
            DATABASE_URL: postgres.appUrl,
            MIGRATION_DATABASE_URL: "",
            MAIL_ENCRYPTION_KEY: mailKey,
            EMAIL_TRANSPORT: "mailpit",
            EMAIL_FROM: "proof@anar.example.test",
            MAILPIT_URL: url,
          },
        );
        await expect
          .poll(
            async () => {
              if (worker.child.exitCode !== null)
                throw new Error("Proof worker exited before readiness");
              return (
                await rows<{ count: number }>(
                  sql`select count(*)::int as count from worker_heartbeats`,
                )
              )[0].count;
            },
            { timeout: 10000 },
          )
          .toBeGreaterThan(before);
        return worker;
      },
      async startApi() {
        const server = createServer();
        await new Promise<void>((resolve) =>
          server.listen(0, "127.0.0.1", resolve),
        );
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("Expected a proof port");
        const port = address.port;
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        expect(port).not.toBeOneOf([3000, 3001, 3100]);
        const api = launch(new URL("../../dist/main.js", import.meta.url), {
          HOST: "127.0.0.1",
          PORT: String(port),
          DATABASE_URL: postgres.appUrl,
          MIGRATION_DATABASE_URL: "",
          MAIL_ENCRYPTION_KEY: mailKey,
          OTP_PEPPER: pepper,
          PUBLIC_ORIGIN: publicOrigin,
          ANAR_LOCAL_HTTP: "true",
          TRUSTED_PROXY_CIDRS: "",
        });
        const url = `http://127.0.0.1:${port}`;
        await expect
          .poll(
            async () => {
              if (api.child.exitCode !== null)
                throw new Error("Proof API exited before readiness");
              try {
                const response = await fetch(`${url}/api/health`, {
                  signal: AbortSignal.timeout(500),
                });
                await response.body?.cancel();
                return response.status;
              } catch {
                return 0;
              }
            },
            { timeout: 10000 },
          )
          .toBe(200);
        return { ...api, url };
      },
      async holdUser(
        userId: string,
        change: (tx: PlatformTx) => Promise<void>,
      ) {
        const held = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const done = runtime.transaction(async (tx) => {
          await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, userId))
            .for("update");
          held.resolve();
          await release.promise;
          await change(tx);
        });
        void done.catch(held.reject);
        await held.promise;
        return { done, release: release.resolve };
      },
      async waitForLock() {
        await expect
          .poll(
            async () =>
              (
                await rows<{ count: number }>(
                  sql`select count(*)::int as count from pg_stat_activity where datname = current_database() and usename = current_user and wait_event_type = 'Lock'`,
                )
              )[0].count,
          )
          .toBeGreaterThan(0);
      },
    };
    return fixture;
  } catch (error) {
    await close();
    throw error;
  }
}

export type AuthFixture = Awaited<ReturnType<typeof startAuthFixture>>;
