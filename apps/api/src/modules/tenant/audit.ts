import { auditLog, type PlatformTx } from "@anar/db/platform";
import type { AuthUser } from "@anar/domain/auth";
import { v7 } from "uuid";

export type AuditAction = "auth.bootstrap_dna";
export type AuditData = { environment: string };
export type AuditActor = { user: AuthUser; companyId: null; ip: string | null };

const audit = {
  async audit(
    tx: PlatformTx,
    actor: AuditActor,
    action: AuditAction,
    target: { type: "user"; id: string },
    data: AuditData,
  ): Promise<void> {
    await tx.insert(auditLog).values({
      id: v7(),
      actorUserId: actor.user.id,
      actorRole: "dna",
      companyId: actor.companyId,
      action,
      targetType: target.type,
      targetId: target.id,
      data: { environment: data.environment },
      ip: actor.ip,
    });
  },
};

export default audit;
