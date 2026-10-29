import { auditLog, type PlatformTx } from "@anar/db/platform";
import type { AuthUser } from "@anar/domain/auth";
import { v7 } from "uuid";

type AuditEvents = {
  "auth.bootstrap_owner": {
    target: { type: "user"; id: string };
    data: { environment: string };
  };
  "agency.created": {
    target: { type: "agency"; id: string };
    data: { inviteId: string };
  };
  "agency.staff_accepted": {
    target: { type: "agency_member"; id: string };
    data: { inviteId: string; inviterId: string };
  };
};
export type AuditAction = keyof AuditEvents;
export type AuditData = AuditEvents[AuditAction]["data"];
export type AuditActor = {
  user: AuthUser;
  role: "owner" | "agency_staff";
  agencyId: string | null;
  companyId: null;
  ip: string | null;
};

const audit = {
  async audit<K extends AuditAction>(
    tx: PlatformTx,
    actor: AuditActor,
    action: K,
    target: AuditEvents[K]["target"],
    data: AuditEvents[K]["data"],
  ): Promise<void> {
    let payload: Record<string, string>;
    if ("environment" in data) payload = { environment: data.environment };
    else if ("inviterId" in data)
      payload = { inviteId: data.inviteId, inviterId: data.inviterId };
    else payload = { inviteId: data.inviteId };
    await tx.insert(auditLog).values({
      id: v7(),
      actorUserId: actor.user.id,
      actorRole: actor.role,
      agencyId: actor.agencyId,
      companyId: actor.companyId,
      action,
      targetType: target.type,
      targetId: target.id,
      data: payload,
      ip: actor.ip,
    });
  },
};

export default audit;
