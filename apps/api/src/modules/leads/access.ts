import type { TenantTx } from "@anar/db/tenant";
import type { Permission } from "@anar/domain/agencies";
import { AppError } from "@anar/domain/errors";
import type { Lead } from "@anar/domain/leads";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import repository from "./repository.js";

const access = {
  // A lead the person may not see looks the same as one that does not exist.
  // Locking rechecks after the lock: an Admin can lose the lead to a reassignment mid-edit.
  async visibleLead(
    tx: TenantTx,
    current: Ctx,
    id: string,
    permission: Extract<
      Permission,
      "leads.view" | "leads.update" | "leads.assign" | "followups.log"
    >,
    lock = false,
  ): Promise<Lead> {
    permissions.require(current, permission);
    const lead = await repository.readLiveLead(tx, id, lock);
    const resource = lead && {
      agencyId: current.agencyId,
      companyId: current.companyId,
      assignedMemberId: lead.assignedTo,
    };
    if (!lead || !permissions.can(current, permission, resource))
      throw new AppError("not_found", "Lead not found");
    return lead;
  },
};
export default access;
