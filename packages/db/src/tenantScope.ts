import { sql } from "drizzle-orm";
import type { AgencyScope, TenantScope, TenantTx } from "./tenant.js";

type Scope =
  | { kind: "identity"; userId: string }
  | ({ kind: "agency" } & AgencyScope)
  | ({ kind: "company" } & TenantScope)
  | {
      kind: "company";
      agencyId: string;
      companyId: string;
      authority: "scheduler";
    }
  | { kind: "scheduler_catalog"; authority: "scheduler" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tenantScope = {
  async set(tx: TenantTx, scope: Scope): Promise<void> {
    const agencyId =
      scope.kind === "identity" || scope.kind === "scheduler_catalog"
        ? ""
        : scope.agencyId;
    const companyId = scope.kind === "company" ? scope.companyId : "";
    const userId = "userId" in scope ? scope.userId : "";
    const scheduler = "authority" in scope;
    if (
      (!scheduler && !uuid.test(userId)) ||
      (scope.kind !== "identity" &&
        scope.kind !== "scheduler_catalog" &&
        !uuid.test(agencyId)) ||
      (scope.kind === "company" && !uuid.test(companyId))
    ) {
      throw new Error("Scope IDs must be UUIDs");
    }
    await tx.execute(sql`select
      set_config('app.scope_kind', ${scope.kind}, true),
      set_config('app.agency_id', ${agencyId}, true),
      set_config('app.company_id', ${companyId}, true),
      set_config('app.user_id', ${userId}, true),
      set_config('app.actor_kind', ${scheduler ? "scheduler" : "user"}, true)`);
  },
  async readCompany(tx: TenantTx): Promise<
    | TenantScope
    | {
        agencyId: string;
        companyId: string;
        userId: null;
        authority: "scheduler";
      }
  > {
    const { rows } = await tx.execute<{
      kind: string | null;
      agencyId: string | null;
      companyId: string | null;
      userId: string | null;
      actorKind: string | null;
    }>(sql`select
      current_setting('app.scope_kind', true) as "kind",
      current_setting('app.agency_id', true) as "agencyId",
      current_setting('app.company_id', true) as "companyId",
      current_setting('app.user_id', true) as "userId",
      current_setting('app.actor_kind', true) as "actorKind"`);
    const [scope] = rows;
    if (
      scope?.kind !== "company" ||
      !scope.agencyId ||
      !scope.companyId ||
      (scope.actorKind === "scheduler" ? scope.userId !== "" : !scope.userId)
    ) {
      throw new Error("Company scope is required");
    }
    if (scope.actorKind === "scheduler")
      return {
        agencyId: scope.agencyId,
        companyId: scope.companyId,
        userId: null,
        authority: "scheduler",
      };
    return {
      agencyId: scope.agencyId,
      companyId: scope.companyId,
      userId: scope.userId as string,
    };
  },
};

export default tenantScope;
