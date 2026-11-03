import { agencies, companies, type PlatformTx } from "@anar/db/platform";
import { setSchedulerScope, type TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import { and, eq } from "drizzle-orm";

const system = {
  async withSystemTenant<T>(
    tx: PlatformTx,
    scope: { agencyId: string; companyId: string; authority: "scheduler" },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    if (scope.authority !== "scheduler")
      throw new AppError("forbidden", "Scheduler authority is required");
    await setSchedulerScope(tx, scope);
    const [company] = await tx
      .select({ id: companies.id })
      .from(companies)
      .innerJoin(agencies, eq(agencies.id, companies.agencyId))
      .where(
        and(
          eq(companies.id, scope.companyId),
          eq(companies.agencyId, scope.agencyId),
          eq(companies.status, "active"),
          eq(agencies.status, "active"),
        ),
      );
    if (!company) throw new AppError("not_found", "Company is unavailable");
    return fn(tx);
  },
};
export default system;
