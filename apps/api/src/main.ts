import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadApiConfig } from "./lib/config.js";
import { createMailCodec } from "./lib/email/crypto.js";
import stepUpCode from "./lib/email/templates/stepUpCode.js";
import { originGuard } from "./lib/http.js";
import agencyContext from "./modules/agencies/context.js";
import agencies from "./modules/agencies/service.js";
import staff from "./modules/agencies/staff.js";
import inviteAcceptance from "./modules/auth/inviteAcceptance.js";
import invites from "./modules/auth/invites.js";
import otp from "./modules/auth/otp.js";
import companies from "./modules/companies/service.js";
import members from "./modules/members/service.js";

export async function startApi(): Promise<void> {
  const host = process.env.HOST ?? "0.0.0.0";
  const portValue = process.env.PORT ?? "3001";
  const port = Number(portValue);
  if (
    !/^\d+$/.test(portValue) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  const config = loadApiConfig();
  const mailCodec = createMailCodec(config.mailKey);
  const now = () => new Date();
  const invitations = invites.create({
    publicOrigin: config.publicOrigin,
    otpPepper: config.otpPepper,
    mailCodec,
    now,
  });
  const runtime = await otp.start({
    connectionString: config.connectionString,
    otpPepper: config.otpPepper,
    mailCodec,
    now,
  });
  let app: FastifyInstance | undefined;
  let agencyRuntime:
    | Awaited<ReturnType<typeof agencyContext.start>>
    | undefined;
  let verifier: Awaited<ReturnType<typeof otp.startVerifier>> | undefined;
  let acceptance:
    | Awaited<ReturnType<typeof inviteAcceptance.start>>
    | undefined;
  try {
    verifier = await otp.startVerifier({
      connectionString: config.connectionString,
      otpPepper: config.otpPepper,
      cookieTransport: config.cookieTransport,
      now,
    });
    const verification = verifier;
    agencyRuntime = await agencyContext.start({
      connectionString: config.connectionString,
      sessions: verification.sessions,
    });
    const contextRuntime = agencyRuntime;
    acceptance = await inviteAcceptance.start({
      connectionString: config.connectionString,
      otpPepper: config.otpPepper,
      now,
      readInitialInviteAgency: agencies.readInitialInviteAgency,
      lockInitialInviteAgency: agencies.lockInitialInviteAgency,
      hasStaffMembership: agencies.hasStaffMembership,
      hasCompanyMembership: members.hasMembership,
      activateInvitedStaff: agencies.activateInvitedStaff,
    });
    const inviteRuntime = acceptance;
    app = buildApp({
      staff: staff.create(contextRuntime.service),
      companies: companies.create({
        context: contextRuntime.service,
        now,
        createCompanyInvite: invitations.createCompanyInvite,
      }),
      invites: inviteRuntime.service,
      agencies: agencies.create({
        sessions: verification.sessions,
        createInitialInvite: invitations.createInitialInvite,
        resendInitialInvite: invitations.resendInitialInvite,
        now,
      }),
      otp: runtime.service,
      verifier: verification.service,
      sessions: verification.sessions,
      stepUp: runtime.createStepUp({
        sessions: verification.sessions,
        renderCode: stepUpCode.render,
      }),
      requireOrigin: originGuard(config.publicOrigin),
      trustProxy: config.trustProxy,
      logging: true,
    });
    const server = app;
    const stop = () => {
      void server.close().catch(() => {
        console.error("API shutdown failed");
        process.exitCode = 1;
      });
    };
    app.addHook("onClose", async () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      await Promise.all([
        runtime.close(),
        verification.close(),
        inviteRuntime.close(),
        contextRuntime.close(),
      ]);
    });
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await app.listen({ host, port });
  } catch (error) {
    if (app) await app.close();
    else
      await Promise.all([
        runtime.close(),
        verifier?.close(),
        acceptance?.close(),
        agencyRuntime?.close(),
      ]);
    throw error;
  }
}

if (import.meta.main) {
  await startApi().catch(() => {
    console.error("API startup failed");
    process.exitCode = 1;
  });
}
