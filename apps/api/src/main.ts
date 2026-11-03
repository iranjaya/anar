import { AppError } from "@anar/domain/errors";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadApiConfig } from "./lib/config.js";
import { createMailCodec } from "./lib/email/crypto.js";
import stepUpCode from "./lib/email/templates/stepUpCode.js";
import { originGuard } from "./lib/http.js";
import { createHealthProbe, enqueue } from "./lib/jobs/index.js";
import agencyContext from "./modules/agencies/context.js";
import agencies from "./modules/agencies/service.js";
import staff from "./modules/agencies/staff.js";
import inviteAcceptance from "./modules/auth/inviteAcceptance.js";
import invites from "./modules/auth/invites.js";
import otp from "./modules/auth/otp.js";
import profiles from "./modules/auth/profiles.js";
import pushBindings from "./modules/auth/pushBindings.js";
import rateLimits from "./modules/auth/rateLimits.js";
import companies from "./modules/companies/service.js";
import {
  createFollowUpService,
  readMemberDayCounts,
} from "./modules/followups/index.js";
import { createImportService } from "./modules/imports/index.js";
import leadFollowUp from "./modules/leads/followUp.js";
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
} from "./modules/leads/index.js";
import nextLead from "./modules/leads/nextLead.js";
import members from "./modules/members/service.js";
import notifications, {
  type NotificationService,
} from "./modules/notifications/service.js";
import { queueSummaryEmail } from "./modules/notifications/summaryEmailQueue.js";
import {
  createScoringService,
  loadActiveConfig,
  scoreLead,
  seedScoringDefaults,
} from "./modules/scoring/index.js";
import {
  createFields,
  createSettingsService,
  extendFieldOptions,
  fieldKeys,
  loadHistoricalReferences,
  loadSchema,
  readOutcomeFacts,
  seedDefaults,
} from "./modules/settings/index.js";
import tenantContext from "./modules/tenant/index.js";
import recipients from "./modules/tenant/recipients.js";

function withPushSwitch(
  enabled: boolean,
  service: NotificationService,
): NotificationService {
  if (enabled) return service;
  const off = async (): Promise<never> => {
    throw new AppError("unavailable", "Push notifications are off");
  };
  return {
    ...service,
    getPushState: off,
    subscribePush: off,
    unsubscribePush: off,
  };
}

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
  const health = createHealthProbe(config.connectionString);
  const runtime = await otp.start({
    connectionString: config.connectionString,
    otpPepper: config.otpPepper,
    mailCodec,
    now,
  });
  let app: FastifyInstance | undefined;
  let tenantRuntime:
    | Awaited<ReturnType<typeof tenantContext.start>>
    | undefined;
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
    tenantRuntime = await tenantContext.start({
      connectionString: config.connectionString,
      sessions: verification.sessions,
      readStaffMembership: agencies.readStaffMembership,
      readActiveAgency: agencies.readActiveAgency,
      readAgencyCompanyBySlug: companies.readAgencyCompanyBySlug,
      discoverWorkspaces: companies.discoverWorkspaces,
      lockActiveCompany: companies.lockActiveCompany,
      readActiveMember: members.readActiveForUser,
    });
    const tenant = tenantRuntime;
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
      readStaffInviteAgency: agencies.readStaffInviteAgency,
      lockStaffInviteAgency: agencies.lockStaffInviteAgency,
      readCompanyInviteTarget: companies.readCompanyInviteTarget,
      lockCompanyInviteTarget: companies.lockCompanyInviteTarget,
      activateInvitedMember: members.activateInvitedMember,
      lockInitialInviteAgency: agencies.lockInitialInviteAgency,
      hasStaffMembership: agencies.hasStaffMembership,
      hasCompanyMembership: members.hasMembership,
      activateInvitedStaff: agencies.activateInvitedStaff,
    });
    const inviteRuntime = acceptance;
    const notificationService = notifications.create({
      context: tenant.service,
      now,
      ...recipients,
      queueSummaryEmail,
      pushEnabled: config.pushEnabled,
      pushHosts: config.pushHosts,
      vapidPublicKey: config.vapidPublicKey,
      bindPushEndpoint: pushBindings.bindPushEndpoint,
    });
    const callWriter = leadFollowUp.create({
      loadSchema,
      loadHistoricalReferences,
      loadActiveConfig,
      scoreLead,
    });
    app = buildApp({
      context: tenant.service,
      discovery: tenant.service,
      staff: staff.create({
        context: contextRuntime.service,
        now,
        createStaffInvite: invitations.createStaffInvite,
        resendStaffInvite: invitations.resendStaffInvite,
        revokeIssuerInvites: invitations.revokeIssuerInvites,
        revokeAllSessions: verification.sessions.revokeAllSessions,
      }),
      companies: companies.create({
        context: contextRuntime.service,
        now,
        createCompanyInvite: invitations.createCompanyInvite,
        async seedCompany(tx) {
          await seedDefaults(tx);
          await seedScoringDefaults(tx);
        },
      }),
      scoring: createScoringService({ context: tenant.service }),
      leads: createLeadListService({ context: tenant.service, loadSchema }),
      leadAssign: createLeadAssignService({
        context: tenant.service,
        now,
        readMember: members.readMember,
        notify: notificationService.notify,
      }),
      today: createTodayService({
        context: tenant.service,
        loadSchema,
        readMemberDayCounts,
        now,
      }),
      followUps: createFollowUpService({
        context: tenant.service,
        now,
        readVisibleLead: callWriter.readVisibleLeadForCall,
        readOutcomeFacts,
        readOriginalBucket: nextLead.readOriginalBucket,
        applyFollowUp: callWriter.applyFollowUp,
        nextLeadId: nextLead.nextLeadId,
        canReceiveCompanyNotification: recipients.canReceiveCompanyNotification,
        notify: notificationService.notify,
      }),
      leadStage: createLeadStageService({
        context: tenant.service,
        now,
        loadSchema,
        loadHistoricalReferences,
      }),
      leadSuggestion: createLeadSuggestionService({
        context: tenant.service,
        now,
      }),
      leadUpdate: createLeadUpdateService({
        context: tenant.service,
        now,
        loadSchema,
        loadActiveConfig,
        scoreLead,
      }),
      leadDetail: createLeadDetailService({
        context: tenant.service,
        loadHistoricalReferences,
        loadActiveConfig,
        readProfiles: profiles.read,
      }),
      imports: createImportService({
        context: tenant.service,
        uploadsRoot: config.uploadsRoot,
        limitUpload: rateLimits.createUploadLimiter(config.otpPepper, now),
        loadSchema,
        findImportMatches,
        now,
        createFields,
        extendFieldOptions,
        fieldKeys,
        enqueue,
      }),
      members: members.create({
        context: tenant.service,
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
        context: tenant.service,
        now,
        references: getReferenceCounts,
      }),
      notifications: withPushSwitch(config.pushEnabled, notificationService),
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
      health,
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
        tenant.close(),
        health.close(),
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
        tenantRuntime?.close(),
        acceptance?.close(),
        health.close(),
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
