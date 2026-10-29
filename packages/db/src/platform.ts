import { createDb } from "./connection.js";
import type { AgencyScope, TenantScope, TenantTx } from "./tenant.js";
import tenantScope from "./tenantScope.js";

export { agencies, agencyMembers } from "./schema/agencies.js";
export { auditLog } from "./schema/audit.js";
export { authRateLimits } from "./schema/authLimits.js";
export {
  companies,
  invites,
  otpCodes,
  sessions,
  users,
} from "./schema/platform.js";
export type { AgencyScope, TenantScope } from "./tenant.js";

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
  await tenantScope.set(tx, { kind: "company", ...scope });
  return fn(tx);
}

export async function withPlatformIdentity<T>(
  tx: PlatformTx,
  userId: string,
  fn: (tx: PlatformTx) => Promise<T>,
): Promise<T> {
  await tenantScope.set(tx, { kind: "identity", userId });
  return fn(tx);
}

export async function withPlatformAgency<T>(
  tx: PlatformTx,
  scope: AgencyScope,
  fn: (tx: PlatformTx) => Promise<T>,
): Promise<T> {
  await tenantScope.set(tx, { kind: "agency", ...scope });
  return fn(tx);
}
