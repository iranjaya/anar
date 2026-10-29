import { createDb } from "./connection.js";
import type { TenantScope, TenantTx } from "./tenant.js";
import tenantScope from "./tenantScope.js";

export { auditLog } from "./schema/audit.js";
export { authRateLimits } from "./schema/authLimits.js";
export { otpCodes, sessions, users } from "./schema/platform.js";

export type PlatformTx = TenantTx;
export type PlatformDb = {
  transaction<T>(fn: (tx: PlatformTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export async function createPlatformDb(
  connectionString: string,
): Promise<PlatformDb> {
  const handle = createDb(connectionString);
  try {
    await handle.requireRole("anar_app");
  } catch (error) {
    await handle.close();
    throw error;
  }
  return {
    close: handle.close,
    transaction: (fn) =>
      handle.withConnection((connection) => connection.transaction(fn)),
  };
}

export async function withPlatformTenant<T>(
  tx: PlatformTx,
  scope: TenantScope,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  await tenantScope.set(tx, scope);
  return fn(tx);
}
