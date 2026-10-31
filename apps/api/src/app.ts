import Fastify, { type FastifyInstance } from "fastify";
import { registerHttp, safeLogger } from "./lib/http.js";
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
import memberRoutes, {
  type MemberRouteOptions,
} from "./modules/members/routes.js";
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
