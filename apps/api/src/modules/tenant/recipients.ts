import { companies, users } from "@anar/db/platform";
import { readCompanyScope, type TenantTx } from "@anar/db/tenant";
import { and, eq, isNull } from "drizzle-orm";
import agencies from "../agencies/service.js";
import profiles from "../auth/profiles.js";
import members from "../members/service.js";

const recipients = {
  async canReceiveCompanyNotification(
    tx: TenantTx,
    userId: string,
  ): Promise<boolean> {
    const scope = await readCompanyScope(tx);
    if ((await profiles.countUsable(tx, [userId])) !== 1) return false;
    if (await members.readActiveForUser(tx, scope.companyId, userId, false))
      return true;
    return agencies.isActiveStaffInScope(tx, scope.agencyId, userId);
  },
  async isScopedCompanyMember(tx: TenantTx, userId: string): Promise<boolean> {
    const scope = await readCompanyScope(tx);
    return Boolean(
      await members.readActiveForUser(tx, scope.companyId, userId, false),
    );
  },
  async readScopedCompanySlug(tx: TenantTx): Promise<string> {
    return (await recipients._scopedCompany(tx)).slug;
  },
  async readScopedCompanyTimezone(tx: TenantTx): Promise<string> {
    return (await recipients._scopedCompany(tx)).timezone;
  },
  async readScopedCompany(tx: TenantTx) {
    return recipients._scopedCompany(tx);
  },
  async readRecipientEmail(
    tx: TenantTx,
    userId: string,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deactivatedAt)))
      .limit(1);
    return row?.email ?? null;
  },
  async _scopedCompany(tx: TenantTx) {
    const scope = await readCompanyScope(tx);
    const [company] = await tx
      .select({
        name: companies.name,
        slug: companies.slug,
        timezone: companies.timezone,
      })
      .from(companies)
      .where(eq(companies.id, scope.companyId));
    if (!company) throw new Error("Scoped company is missing");
    return company;
  },
};
export default recipients;
