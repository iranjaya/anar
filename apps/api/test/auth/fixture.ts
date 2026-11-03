import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  agencies as agencyRows,
  authRateLimits,
  companies as companyRows,
  createPlatformDb,
  otpCodes,
  type PlatformTx,
  sessions,
  users,
  withPlatformAgency,
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
import { pushHosts } from "../../src/lib/config.js";
import { createMailCodec } from "../../src/lib/email/crypto.js";
import stepUpCode from "../../src/lib/email/templates/stepUpCode.js";
import { originGuard } from "../../src/lib/http.js";
import { enqueue } from "../../src/lib/jobs/index.js";
import agencyContext from "../../src/modules/agencies/context.js";
import agencies from "../../src/modules/agencies/service.js";
import staff from "../../src/modules/agencies/staff.js";
import bootstrap from "../../src/modules/auth/bootstrap.js";
import type { CookieTransport } from "../../src/modules/auth/cookies.js";
import inviteAcceptance from "../../src/modules/auth/inviteAcceptance.js";
import invites from "../../src/modules/auth/invites.js";
import otp from "../../src/modules/auth/otp.js";
import profiles from "../../src/modules/auth/profiles.js";
import pushBindings from "../../src/modules/auth/pushBindings.js";
import rateLimits from "../../src/modules/auth/rateLimits.js";
import type { SessionService } from "../../src/modules/auth/sessions.js";
import companies from "../../src/modules/companies/service.js";
import {
  createFollowUpService,
  readMemberDayCounts,
} from "../../src/modules/followups/index.js";
import { createImportService } from "../../src/modules/imports/index.js";
import leadFollowUp from "../../src/modules/leads/followUp.js";
import {
  createLeadAssignService,
  createLeadDetailService,
  createLeadListService,
  createLeadStageService,
  createLeadSuggestionService,
  createLeadUpdateService,
  createTodayService,
  findImportMatches,
  getMemberLeadCounts,
  getReferenceCounts,
  reassignOpenLeads,
} from "../../src/modules/leads/index.js";
import nextLead from "../../src/modules/leads/nextLead.js";
import members from "../../src/modules/members/service.js";
import notifications from "../../src/modules/notifications/service.js";
import { queueSummaryEmail } from "../../src/modules/notifications/summaryEmailQueue.js";
import {
  createScoringService,
  loadActiveConfig,
  scoreLead,
  seedScoringDefaults,
} from "../../src/modules/scoring/index.js";
import {
  createFields,
  createSettingsService,
  extendFieldOptions,
  fieldKeys,
  loadHistoricalReferences,
  loadSchema,
  readOutcomeFacts,
  seedDefaults,
} from "../../src/modules/settings/index.js";
import tenantContext from "../../src/modules/tenant/index.js";
import recipients from "../../src/modules/tenant/recipients.js";

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
  tenant: ReturnType<typeof tenantContext.create>;
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
  const uploadsRoot = mkdtempSync(path.join(tmpdir(), "anar-uploads-"));
  const vapidPublicKey = createECDH("prime256v1")
    .generateKeys()
    .toString("base64url");
  const mailKey = randomBytes(32).toString("base64");
  const codec = createMailCodec(mailKey);
  const invitations = invites.create({
    publicOrigin,
    otpPepper: pepper,
    mailCodec: codec,
    now,
  });
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
      const tenant = tenantContext.create({
        db,
        sessions: verification.sessions,
        readStaffMembership: agencies.readStaffMembership,
        readActiveAgency: agencies.readActiveAgency,
        readAgencyCompanyBySlug: companies.readAgencyCompanyBySlug,
        discoverWorkspaces: companies.discoverWorkspaces,
        lockActiveCompany: companies.lockActiveCompany,
        readActiveMember: members.readActiveForUser,
      });
      const notificationService = notifications.create({
        context: tenant,
        now,
        ...recipients,
        queueSummaryEmail,
        pushEnabled: true,
        pushHosts,
        vapidPublicKey,
        bindPushEndpoint: pushBindings.bindPushEndpoint,
      });
      const callWriter = leadFollowUp.create({
        loadSchema,
        loadHistoricalReferences,
        loadActiveConfig,
        scoreLead,
      });
      const app = buildApp({
        context: tenant,
        discovery: tenant,
        members: members.create({
          context: tenant,
          now,
          createCompanyInvite: invitations.createCompanyInvite,
          resendCompanyInvite: invitations.resendCompanyInvite,
          getMemberLeadCounts,
          reassignOpenLeads: (tx, current, from, to, meta) =>
            reassignOpenLeads(
              tx,
              {
                readMember: members.readMember,
                notify: notificationService.notify,
              },
              current,
              from,
              to,
              meta,
            ),
        }),
        settings: createSettingsService({
          context: tenant,
          now,
          references: getReferenceCounts,
        }),
        notifications: notificationService,
        companies: companies.create({
          createCompanyInvite: invitations.createCompanyInvite,
          context: agencyContext.create({
            db,
            sessions: verification.sessions,
          }),
          now,
          async seedCompany(tx) {
            await seedDefaults(tx);
            await seedScoringDefaults(tx);
          },
        }),
        scoring: createScoringService({ context: tenant }),
        leads: createLeadListService({ context: tenant, loadSchema }),
        leadAssign: createLeadAssignService({
          context: tenant,
          now,
          readMember: members.readMember,
          notify: notificationService.notify,
        }),
        today: createTodayService({
          context: tenant,
          loadSchema,
          readMemberDayCounts,
          now,
        }),
        followUps: createFollowUpService({
          context: tenant,
          now,
          readVisibleLead: callWriter.readVisibleLeadForCall,
          readOutcomeFacts,
          readOriginalBucket: nextLead.readOriginalBucket,
          applyFollowUp: callWriter.applyFollowUp,
          nextLeadId: nextLead.nextLeadId,
          canReceiveCompanyNotification:
            recipients.canReceiveCompanyNotification,
          notify: notificationService.notify,
        }),
        leadStage: createLeadStageService({
          context: tenant,
          now,
          loadSchema,
          loadHistoricalReferences,
        }),
        leadSuggestion: createLeadSuggestionService({
          context: tenant,
          now,
        }),
        leadUpdate: createLeadUpdateService({
          context: tenant,
          now,
          loadSchema,
          loadActiveConfig,
          scoreLead,
        }),
        leadDetail: createLeadDetailService({
          context: tenant,
          loadHistoricalReferences,
          loadActiveConfig,
          readProfiles: profiles.read,
        }),
        imports: createImportService({
          context: tenant,
          uploadsRoot,
          limitUpload: rateLimits.createUploadLimiter(pepper, now),
          loadSchema,
          findImportMatches,
          now,
          createFields,
          extendFieldOptions,
          fieldKeys,
          enqueue,
        }),
        staff: staff.create({
          context: agencyContext.create({
            db,
            sessions: verification.sessions,
          }),
          now,
          createStaffInvite: invitations.createStaffInvite,
          resendStaffInvite: invitations.resendStaffInvite,
          revokeIssuerInvites: invitations.revokeIssuerInvites,
          revokeAllSessions: verification.sessions.revokeAllSessions,
        }),
        invites: inviteAcceptance.create({
          db,
          otpPepper: pepper,
          now,
          readInitialInviteAgency: agencies.readInitialInviteAgency,
          readStaffInviteAgency: agencies.readStaffInviteAgency,
          lockStaffInviteAgency: agencies.lockStaffInviteAgency,
          readCompanyInviteTarget: companies.readCompanyInviteTarget,
          lockCompanyInviteTarget: companies.lockCompanyInviteTarget,
          activateInvitedMember: members.activateInvitedMember,
          lockInitialInviteAgency: agencies.lockInitialInviteAgency,
          hasStaffMembership: agencies.hasStaffMembership,
          hasCompanyMembership: members.hasMembership,
          activateInvitedStaff: agencies.activateInvitedStaff,
        }),
        agencies: agencies.create({
          sessions: verification.sessions,
          createInitialInvite: invitations.createInitialInvite,
          resendInitialInvite: invitations.resendInitialInvite,
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
        tenant,
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
      invitations,
      now,
      uploadsRoot,
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
      async seedCompany(userId: string) {
        return runtime.transaction(async (tx) => {
          const agencyId = v7();
          await tx.insert(agencyRows).values({
            id: agencyId,
            name: "Proof agency",
            slug: `agency-${agencyId}`,
            status: "active",
            createdBy: userId,
          });
          return withPlatformAgency(
            tx,
            { agencyId, userId },
            async (scoped) => {
              const [company] = await scoped
                .insert(companyRows)
                .values({
                  id: v7(),
                  agencyId,
                  name: "Proof company",
                  slug: `company-${v7()}`,
                  status: "active",
                  defaultCountry: "NP",
                  timezone: "Asia/Kathmandu",
                })
                .returning();
              return company;
            },
          );
        });
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
            PUBLIC_ORIGIN: publicOrigin,
            UPLOADS_ROOT: uploadsRoot,
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
          UPLOADS_ROOT: path.join(tmpdir(), `anar-uploads-${v7()}`),
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
          .toBeOneOf([200, 503]);
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
