import { createPlatformDb } from "@anar/db/platform";
import context, { type ContextDeps } from "./context.js";
import discovery, { type DiscoveryDeps } from "./discovery.js";

export type { Ctx } from "./context.js";

export type TenantDeps = ContextDeps & DiscoveryDeps;
const tenant = {
  create(deps: TenantDeps) {
    return { ...context.create(deps), ...discovery.create(deps) };
  },
  async start(options: Omit<TenantDeps, "db"> & { connectionString: string }) {
    const db = await createPlatformDb(options.connectionString);
    return { service: tenant.create({ ...options, db }), close: db.close };
  },
};
export default tenant;
