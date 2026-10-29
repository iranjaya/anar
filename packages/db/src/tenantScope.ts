import { sql } from "drizzle-orm";
import type { AgencyScope, TenantScope, TenantTx } from "./tenant.js";

type Scope =
  | { kind: "identity"; userId: string }
  | ({ kind: "agency" } & AgencyScope)
  | ({ kind: "company" } & TenantScope);

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tenantScope = {
  async set(tx: TenantTx, scope: Scope): Promise<void> {
    const agencyId = scope.kind === "identity" ? "" : scope.agencyId;
    const companyId = scope.kind === "company" ? scope.companyId : "";
    if (
      !uuid.test(scope.userId) ||
      (scope.kind !== "identity" && !uuid.test(agencyId)) ||
      (scope.kind === "company" && !uuid.test(companyId))
    ) {
      throw new Error("Scope IDs must be UUIDs");
    }
    await tx.execute(sql`select
      set_config('app.scope_kind', ${scope.kind}, true),
      set_config('app.agency_id', ${agencyId}, true),
      set_config('app.company_id', ${companyId}, true),
      set_config('app.user_id', ${scope.userId}, true)`);
  },
};

export default tenantScope;
