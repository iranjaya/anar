import { createDb, type DbHandle } from "./connection.js";
import tenantScope from "./tenantScope.js";

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
