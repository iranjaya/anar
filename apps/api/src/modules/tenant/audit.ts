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
  "settings.field_created": {
    target: { type: "field"; id: string };
    data: { fieldId: string };
  };
  "settings.field_updated": {
    target: { type: "field"; id: string };
    data: { fieldId: string };
  };
  "settings.field_archived": {
    target: { type: "field"; id: string };
    data: { fieldId: string };
  };
  "settings.stage_saved": {
    target: { type: "stage"; id: string };
    data: { stageId: string };
  };
  "settings.stages_reordered": {
    target: { type: "company"; id: string };
    data: { count: string };
  };
  "settings.stage_archived": {
    target: { type: "stage"; id: string };
    data: { stageId: string };
  };
  "settings.outcome_saved": {
    target: { type: "outcome"; id: string };
    data: { outcomeId: string };
  };
  "settings.outcome_archived": {
    target: { type: "outcome"; id: string };
    data: { outcomeId: string };
  };
  "settings.reason_saved": {
    target: { type: "lost_reason"; id: string };
    data: { lostReasonId: string };
  };
  "settings.reason_archived": {
    target: { type: "lost_reason"; id: string };
    data: { lostReasonId: string };
  };
  "leads.assign": {
    target: { type: "company"; id: string };
    data: { count: string; memberId: string; assignmentId: string };
  };
  "leads.stage_changed": {
    target: { type: "lead"; id: string };
    data: { stageId: string };
  };
  "leads.updated": {
    target: { type: "lead"; id: string };
    data: { count: string };
  };
  "followups.logged": {
    target: { type: "lead"; id: string };
    data: { followUpId: string; outcomeId: string };
  };
  "leads.suggestion_dismissed": {
    target: { type: "lead"; id: string };
    data: { suggestionEventId: string };
  };
  "imports.resumed": {
    target: { type: "import_batch"; id: string };
    data: { batchId: string; runId: string };
  };
  "imports.committed": {
    target: { type: "import_batch"; id: string };
    data: { batchId: string; runId: string };
  };
  "imports.uploaded": {
    target: { type: "import_batch"; id: string };
    data: { batchId: string; rowCount: string };
  };
  "notifications.subscribed": {
    target: { type: "push_subscription"; id: string };
    data: { subscriptionId: string };
  };
  "notifications.unsubscribed": {
    target: { type: "push_subscription"; id: string };
    data: { subscriptionId: string };
  };
  "notifications.read": {
    target: { type: "company"; id: string };
    data: { count: string };
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
    else if ("assignmentId" in data)
      payload = {
        count: data.count,
        memberId: data.memberId,
        assignmentId: data.assignmentId,
      };
    else if ("count" in data) payload = { count: data.count };
    else if ("subscriptionId" in data)
      payload = { subscriptionId: data.subscriptionId };
    else if ("runId" in data)
      payload = { batchId: data.batchId, runId: data.runId };
    else if ("batchId" in data)
      payload = { batchId: data.batchId, rowCount: data.rowCount };
    else if ("fieldId" in data) payload = { fieldId: data.fieldId };
    else if ("stageId" in data) payload = { stageId: data.stageId };
    else if ("followUpId" in data)
      payload = { followUpId: data.followUpId, outcomeId: data.outcomeId };
    else if ("suggestionEventId" in data)
      payload = { suggestionEventId: data.suggestionEventId };
    else if ("outcomeId" in data) payload = { outcomeId: data.outcomeId };
    else if ("lostReasonId" in data)
      payload = { lostReasonId: data.lostReasonId };
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
