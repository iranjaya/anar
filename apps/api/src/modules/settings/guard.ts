import type { AuditActor } from "../tenant/audit.js";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import stepUp from "../tenant/stepUp.js";

export type Meta = { at: Date; ip: string | null };

const guard = {
  manage(current: Ctx, meta: Meta): void {
    permissions.require(current, "settings.manage");
    stepUp.requireFreshOtp(current, meta.at);
  },
  actor(current: Ctx, meta: Meta): AuditActor {
    return {
      user: current.user,
      role: current.role,
      agencyId: current.agencyId,
      companyId: current.companyId,
      ip: meta.ip,
    };
  },
};
export default guard;
