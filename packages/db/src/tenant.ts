import { createDb, type DbHandle } from "./connection.js";
import tenantScope from "./tenantScope.js";

export { followUps } from "./schema/followups.js";
export { importBatches, importRows, importRuns } from "./schema/imports.js";
export { companyJobPeriods } from "./schema/jobPeriods.js";
export { leadEvents } from "./schema/leadEvents.js";
export { leads } from "./schema/leads.js";
export { mappingTemplates } from "./schema/mappingTemplates.js";
export { companyMembers } from "./schema/members.js";
export { notificationDeliveries } from "./schema/notificationDeliveries.js";
export { notifications } from "./schema/notifications.js";
export { pushSubscriptions } from "./schema/pushSubscriptions.js";
export { scoringConfigs } from "./schema/scoring.js";
export {
  fields,
  lostReasons,
  outcomes,
  stages,
} from "./schema/settings.js";

export const readCompanyScope = (tx: TenantTx) => tenantScope.readCompany(tx);
export const setSchedulerScope = (
  tx: TenantTx,
  scope: { agencyId: string; companyId: string },
) => tenantScope.set(tx, { kind: "company", ...scope, authority: "scheduler" });
export const setSchedulerCatalogScope = (tx: TenantTx) =>
  tenantScope.set(tx, { kind: "scheduler_catalog", authority: "scheduler" });

export type AgencyScope = { agencyId: string; userId: string };
export type TenantScope = AgencyScope & { companyId: string };
export type TenantTx = Parameters<
  Parameters<DbHandle["db"]["transaction"]>[0]
>[0];
export type TenantDb = {
  withTenant<T>(
    scope: TenantScope,
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
};

export async function createTenantDb(
  connectionString: string,
): Promise<TenantDb> {
  const handle = createDb(connectionString);
  try {
    await handle.requireRole("anar_app");
  } catch (error) {
    await handle.close();
    throw error;
  }

  return {
    close: handle.close,
    async withTenant<T>(
      scope: TenantScope,
      fn: (tx: TenantTx) => Promise<T>,
    ): Promise<T> {
      return handle.withConnection((connection) =>
        connection.transaction(async (tx) => {
          await tenantScope.set(tx, { kind: "company", ...scope });
          return fn(tx);
        }),
      );
    },
  };
}
