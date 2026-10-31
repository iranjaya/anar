import { auditLog, type PlatformTx } from "@anar/db/platform";
import type { AuthUser } from "@anar/domain/auth";
import { and, desc, eq } from "drizzle-orm";
import { v7 } from "uuid";

type AuditEvents = {
  "company.member_accepted": {
    target: { type: "company_member"; id: string };
    data: { inviteId: string; inviterId: string };
  };
  "company.super_admin_invited": {
    target: { type: "invite"; id: string };
    data: { inviteId: string };
  };
  "company.admin_invited": {
    target: { type: "invite"; id: string };
    data: { inviteId: string };
  };
  "company.invite_resent": {
    target: { type: "invite"; id: string };
    data: { inviteId: string };
  };
  "company.member_deactivated": {
    target: { type: "company_member"; id: string };
    data: { userId: string };
  };
  "company.created": {
    target: { type: "company"; id: string };
    data: { companyId: string };
  };
  "agency.enter_company": {
    target: { type: "company"; id: string };
    data: { companyId: string; reason: string };
  };
  "agency.leave_company": {
    target: { type: "company"; id: string };
    data: { companyId: string };
  };
  "auth.bootstrap_owner": {
    target: { type: "user"; id: string };
    data: { environment: string };
  };
  "agency.created": {
    target: { type: "agency"; id: string };
    data: { inviteId: string };
  };
  "agency.first_invite_resent": {
    target: { type: "invite"; id: string };
    data: { inviteId: string };
  };
  "agency.staff_invited": {
    target: { type: "invite"; id: string };
    data: { inviteId: string };
  };
  "agency.staff_invite_resent": {
    target: { type: "invite"; id: string };
    data: { inviteId: string };
  };
  "agency.staff_accepted": {
    target: { type: "agency_member"; id: string };
    data: { inviteId: string; inviterId: string };
  };
  "agency.staff_deactivated": {
    target: { type: "agency_member"; id: string };
    data: { userId: string };
  };
};
export type AuditAction = keyof AuditEvents;
export type AuditData = AuditEvents[AuditAction]["data"];
export type AuditActor = {
  user: AuthUser;
  role: "owner" | "agency_staff" | "super_admin" | "admin";
  agencyId: string | null;
  companyId: string | null;
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
    else if ("reason" in data)
      payload = { companyId: data.companyId, reason: data.reason };
    else if ("companyId" in data) payload = { companyId: data.companyId };
    else if ("userId" in data) payload = { userId: data.userId };
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

  async listCompanyEntries(tx: PlatformTx, companyId: string) {
    const action: AuditAction = "agency.enter_company";
    const rows = await tx
      .select({
        id: auditLog.id,
        actorUserId: auditLog.actorUserId,
        data: auditLog.data,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        and(eq(auditLog.companyId, companyId), eq(auditLog.action, action)),
      )
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(30);
    return rows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      reason: (row.data as { reason: string }).reason,
      enteredAt: row.createdAt,
    }));
  },
};

export default audit;
