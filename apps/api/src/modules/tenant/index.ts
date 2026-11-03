import { createPlatformDb } from "@anar/db/platform";
import type { TenantTx } from "@anar/db/tenant";
import context, { type ContextDeps } from "./context.js";
import discovery, { type DiscoveryDeps } from "./discovery.js";
import system from "./system.js";

export type { Ctx } from "./context.js";
export { default as importJobs, type ImportJobCtx } from "./jobs.js";
export { default as system } from "./system.js";

export type TenantDeps = ContextDeps & DiscoveryDeps;
const tenant = {
  create(deps: TenantDeps) {
    return { ...context.create(deps), ...discovery.create(deps) };
  },
  async start(options: Omit<TenantDeps, "db"> & { connectionString: string }) {
    const db = await createPlatformDb(options.connectionString);
    return { service: tenant.create({ ...options, db }), close: db.close };
  },
  async startSystem(connectionString: string): Promise<{
    withSystemTenant<T>(
      scope: { agencyId: string; companyId: string; authority: "scheduler" },
      fn: (tx: TenantTx) => Promise<T>,
    ): Promise<T>;
    close(): Promise<void>;
  }> {
    const db = await createPlatformDb(connectionString);
    return {
      withSystemTenant: (scope, fn) =>
        db.transaction((tx) => system.withSystemTenant(tx, scope, fn)),
      close: db.close,
    };
  },
};
export default tenant;
