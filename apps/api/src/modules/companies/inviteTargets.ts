import { type PlatformTx, withPlatformTenant } from "@anar/db/platform";
import agencies from "../agencies/service.js";
import type {
  CompanyInviteTargetInput,
  ReadCompanyInviteTarget,
} from "../auth/invites.js";
import members from "../members/service.js";
import repository from "./repository.js";

const inviteTargets = {
  read(
    tx: PlatformTx,
    input: CompanyInviteTargetInput,
  ): ReturnType<ReadCompanyInviteTarget> {
    return inviteTargets._resolve(tx, input, false);
  },
  lock(
    tx: PlatformTx,
    input: CompanyInviteTargetInput,
  ): ReturnType<ReadCompanyInviteTarget> {
    return inviteTargets._resolve(tx, input, true);
  },
  async _resolve(
    tx: PlatformTx,
    input: CompanyInviteTargetInput,
    lock: boolean,
  ): ReturnType<ReadCompanyInviteTarget> {
    const agency = await agencies.readActiveAgency(tx, input.agencyId, lock);
    if (!agency) return undefined;
    const scope = {
      agencyId: input.agencyId,
      companyId: input.companyId,
      userId: input.issuerId,
    };
    const company = await withPlatformTenant(tx, scope, (scoped) =>
      repository.readActive(scoped, input.agencyId, input.companyId, lock),
    );
    if (!company) return undefined;
    const staff = await agencies.hasActiveStaff(
      tx,
      input.agencyId,
      input.issuerId,
      lock,
    );
    if (!staff) {
      if (input.role !== "admin") return undefined;
      const manager = await withPlatformTenant(tx, scope, (scoped) =>
        members.hasActiveSuperAdmin(
          scoped,
          input.companyId,
          input.issuerId,
          lock,
        ),
      );
      if (!manager) return undefined;
    }
    return { agencyName: agency.name, companyName: company.name };
  },
};
export default inviteTargets;
