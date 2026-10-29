import Fastify, { type FastifyInstance } from "fastify";
import { registerHttp, safeLogger } from "./lib/http.js";
import agencyRoutes, {
  type AgencyRouteOptions,
} from "./modules/agencies/routes.js";
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
import healthRoutes from "./routes/health.js";

export type AppDeps = AuthRouteOptions &
  VerifyRouteOptions &
  RefreshRouteOptions &
  SessionRouteOptions &
  StepUpRouteOptions &
  AgencyRouteOptions &
  InviteRouteOptions & {
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
  app.register(healthRoutes);
  if (deps) {
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
