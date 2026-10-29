import { sql } from "drizzle-orm";
import { createDb, type DbHandle } from "./connection.js";

export type TenantScope = { companyId: string; userId: string };
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

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      if (!uuid.test(scope.companyId) || !uuid.test(scope.userId)) {
        throw new Error("Tenant companyId and userId must be UUIDs");
      }
      return handle.withConnection((connection) =>
        connection.transaction(async (tx) => {
          await tx.execute(sql`select
            set_config('app.company_id', ${scope.companyId}, true),
            set_config('app.user_id', ${scope.userId}, true)`);
          return fn(tx);
        }),
      );
    },
  };
}
