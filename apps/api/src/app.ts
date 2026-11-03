import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { registerHttp, safeLogger, uploadLimits } from "./lib/http.js";
import agencyRoutes, {
  type AgencyRouteOptions,
} from "./modules/agencies/routes.js";
import staffRoutes, {
  type StaffRouteOptions,
} from "./modules/agencies/staffRoutes.js";
import discoveryRoutes, {
  type DiscoveryRouteOptions,
} from "./modules/auth/discoveryRoutes.js";
import inviteRoutes, {
  type InviteRouteOptions,
} from "./modules/auth/inviteRoutes.js";
import type {
  AuthRouteOptions,
  RefreshRouteOptions,
  SessionRouteOptions,
  StepUpRouteOptions,
  VerifyRouteOptions,
} from "./modules/auth/routes.js";
import routes from "./modules/auth/routes.js";
import companyRoutes, {
  type CompanyRouteOptions,
} from "./modules/companies/routes.js";
import {
  type FollowUpRouteOptions,
  followUpRoutes,
} from "./modules/followups/index.js";
import {
  type ImportRouteOptions,
  importRoutes,
} from "./modules/imports/index.js";
import {
  type LeadAssignRouteOptions,
  type LeadDetailRouteOptions,
  type LeadRouteOptions,
  type LeadStageRouteOptions,
  type LeadSuggestionRouteOptions,
  type LeadUpdateRouteOptions,
  leadRoutes,
  type TodayRouteOptions,
  todayRoutes,
} from "./modules/leads/index.js";
import memberRoutes, {
  type MemberRouteOptions,
} from "./modules/members/routes.js";
import notificationRoutes, {
  type NotificationRouteOptions,
} from "./modules/notifications/routes.js";
import {
  type ScoringRouteOptions,
  scoringRoutes,
} from "./modules/scoring/index.js";
import {
  type SettingsRouteOptions,
  settingsRoutes,
} from "./modules/settings/index.js";
import contextRoutes, {
  type ContextRouteOptions,
} from "./modules/tenant/routes.js";
import healthRoutes, { type HealthRouteOptions } from "./routes/health.js";

export type AppDeps = AuthRouteOptions &
  DiscoveryRouteOptions &
  ContextRouteOptions &
  VerifyRouteOptions &
  RefreshRouteOptions &
  SessionRouteOptions &
  StepUpRouteOptions &
  AgencyRouteOptions &
  StaffRouteOptions &
  CompanyRouteOptions &
  MemberRouteOptions &
  NotificationRouteOptions &
  SettingsRouteOptions &
  ScoringRouteOptions &
  ImportRouteOptions &
  LeadRouteOptions &
  LeadDetailRouteOptions &
  LeadUpdateRouteOptions &
  LeadStageRouteOptions &
  LeadSuggestionRouteOptions &
  LeadAssignRouteOptions &
  TodayRouteOptions &
  FollowUpRouteOptions &
  InviteRouteOptions &
  HealthRouteOptions & {
    trustProxy: false | string[];
    logging?: boolean;
  };

export function buildApp(deps?: AppDeps): FastifyInstance {
  const app = Fastify({
    exposeHeadRoutes: false,
    trustProxy: deps?.trustProxy ?? false,
    requestIdHeader: false,
    logger: deps?.logging ? safeLogger : false,
  });
  registerHttp(app);
  app.register(healthRoutes, { health: deps?.health });
  if (deps) {
    app.register(multipart, { limits: uploadLimits });
    app.register(discoveryRoutes.register, { discovery: deps.discovery });
    app.register(contextRoutes.register, { context: deps.context });
    app.register(companyRoutes.register, {
      companies: deps.companies,
      requireOrigin: deps.requireOrigin,
    });
    app.register(memberRoutes.register, {
      members: deps.members,
      requireOrigin: deps.requireOrigin,
    });
    app.register(notificationRoutes.register, {
      notifications: deps.notifications,
      requireOrigin: deps.requireOrigin,
    });
    app.register(settingsRoutes.register, {
      settings: deps.settings,
      requireOrigin: deps.requireOrigin,
    });
    app.register(scoringRoutes.register, { scoring: deps.scoring });
    app.register(leadRoutes.register, { leads: deps.leads });
    app.register(leadRoutes.registerDetail, { leadDetail: deps.leadDetail });
    app.register(leadRoutes.registerAssign, {
      leadAssign: deps.leadAssign,
      requireOrigin: deps.requireOrigin,
    });
    app.register(todayRoutes.register, { today: deps.today });
    app.register(followUpRoutes.register, {
      followUps: deps.followUps,
      requireOrigin: deps.requireOrigin,
    });
    app.register(leadRoutes.registerStage, {
      leadStage: deps.leadStage,
      requireOrigin: deps.requireOrigin,
    });
    app.register(leadRoutes.registerSuggestion, {
      leadSuggestion: deps.leadSuggestion,
      requireOrigin: deps.requireOrigin,
    });
    app.register(leadRoutes.registerUpdate, {
      leadUpdate: deps.leadUpdate,
      requireOrigin: deps.requireOrigin,
    });
    app.register(importRoutes.register, {
      imports: deps.imports,
      requireOrigin: deps.requireOrigin,
    });
    app.register(staffRoutes.register, {
      staff: deps.staff,
      requireOrigin: deps.requireOrigin,
    });
    app.register(inviteRoutes.register, {
      invites: deps.invites,
      requireOrigin: deps.requireOrigin,
    });
    app.register(agencyRoutes.register, {
      agencies: deps.agencies,
      requireOrigin: deps.requireOrigin,
    });
    app.register(routes.register, {
      otp: deps.otp,
      requireOrigin: deps.requireOrigin,
    });
    app.register(routes.registerVerification, {
      verifier: deps.verifier,
      requireOrigin: deps.requireOrigin,
    });
    app.register(routes.registerRefresh, {
      sessions: deps.sessions,
      requireOrigin: deps.requireOrigin,
    });
    app.register(routes.registerSessions, {
      sessions: deps.sessions,
      requireOrigin: deps.requireOrigin,
    });
    app.register(routes.registerStepUp, {
      stepUp: deps.stepUp,
      sessions: deps.sessions,
      requireOrigin: deps.requireOrigin,
    });
  }
  return app;
}
