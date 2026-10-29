import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import type {
  ActivateInvitedMemberInput,
  CompanyMember,
} from "@anar/domain/members";
import { v7 } from "uuid";
import repository from "./repository.js";

const members = {
  ownActiveCompanyIds: repository.ownActiveCompanyIds,
  readActiveForUser: repository.readActiveForUser,
  hasMembership: repository.hasMembership,
  countActive: repository.countActive,
  async hasActiveSuperAdmin(
    tx: TenantTx,
    companyId: string,
    userId: string,
    lock = false,
  ): Promise<boolean> {
    return (
      (await repository.readActiveForUser(tx, companyId, userId, lock))
        ?.role === "super_admin"
    );
  },
  async activateInvitedMember(
    tx: TenantTx,
    input: ActivateInvitedMemberInput,
  ): Promise<CompanyMember> {
    const { at, ...details } = input;
    const member = await repository.insert(tx, {
      ...details,
      id: v7(),
      status: "active",
      createdAt: at,
      updatedAt: at,
    });
    if (!member)
      throw new AppError(
        "conflict",
        "Invite cannot be accepted by this account",
      );
    return member;
  },
  async requireActiveMember(
    tx: TenantTx,
    companyId: string,
    memberId: string,
  ): Promise<CompanyMember> {
    const member = await repository.readActive(tx, companyId, memberId);
    if (!member) throw new AppError("not_found", "Member is unavailable");
    return member;
  },
};
export default members;
