import { sql } from "drizzle-orm";
import type { TenantScope, TenantTx } from "./tenant.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tenantScope = {
  async set(tx: TenantTx, scope: TenantScope): Promise<void> {
    if (!uuid.test(scope.companyId) || !uuid.test(scope.userId)) {
      throw new Error("Tenant companyId and userId must be UUIDs");
    }
    await tx.execute(sql`select
      set_config('app.company_id', ${scope.companyId}, true),
      set_config('app.user_id', ${scope.userId}, true)`);
  },
};

export default tenantScope;
