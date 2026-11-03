import type { TenantTx } from "@anar/db/tenant";
import {
  type AssignedData,
  type AssignLeadsInput,
  assignLeadsInputSchema,
  type UnassignedData,
} from "@anar/domain/assignment";
import { AppError } from "@anar/domain/errors";
import type { NotificationInput } from "@anar/domain/notifications";
import type { FastifyRequest } from "fastify";
import { v7 } from "uuid";
import audit from "../tenant/audit.js";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import events from "./events.js";
import repository from "./repository.js";

type Member = {
  id: string;
  userId: string;
  status: "invited" | "active" | "deactivated";
};
export type LeadAssignDeps = {
  context: Pick<
    ReturnType<typeof tenant.create>,
    "requireContext" | "withContext"
  >;
  now(): Date;
  readMember(
    tx: TenantTx,
    companyId: string,
    memberId: string,
    lock: boolean,
  ): Promise<Member | undefined>;
  notify(tx: TenantTx, input: NotificationInput): Promise<{ id: string }>;
};
type WriteDeps = Pick<LeadAssignDeps, "readMember" | "notify">;
type Meta = { at: Date; ip: string | null };
type Row = { id: string; assignedTo: string | null };
const batchSize = 500;

const assign = {
  create(deps: LeadAssignDeps) {
    return {
      requireContext(
        request: Pick<FastifyRequest, "headers">,
        slug: string,
      ): Promise<Ctx> {
        return deps.context.requireContext(request, slug);
      },
      async assign(
        actor: Ctx,
        raw: AssignLeadsInput,
        meta: { ip: string | null },
      ): Promise<{ updated: number }> {
        const parsed = assignLeadsInputSchema.safeParse(raw);
        if (!parsed.success)
          throw new AppError("validation", "Choose up to 500 leads");
        const input = parsed.data;
        const at = deps.now();
        // The target's identity is locked first, so it is read once here and rechecked under lock.
        const target = input.memberId
          ? await deps.context.withContext(actor, (tx, current) =>
              deps.readMember(
                tx,
                current.companyId,
                input.memberId as string,
                false,
              ),
            )
          : null;
        if (input.memberId && !target)
          throw new AppError("validation", "Choose an active member");
        return deps.context.withContext(
          actor,
          (tx, current) =>
            assign.assignLeads(tx, deps, current, input, { at, ip: meta.ip }),
          target ? [target.userId] : [],
        );
      },
    };
  },

  // Runs in the caller's transaction. Every lead must be visible before any is changed.
  async assignLeads(
    tx: TenantTx,
    deps: WriteDeps,
    current: Ctx,
    input: AssignLeadsInput,
    meta: Meta,
  ): Promise<{ updated: number }> {
    permissions.require(current, "leads.assign");
    const to = await assign._activeMember(tx, deps, current, input.memberId);
    const rows = await repository.lockLiveLeads(tx, input.leadIds);
    if (rows.length !== input.leadIds.length)
      throw new AppError("not_found", "Lead not found");
    const changed = rows.filter((row) => row.assignedTo !== (to?.id ?? null));
    if (!changed.length) return { updated: 0 };
    const assignmentId = v7();
    await assign._write(
      tx,
      current,
      changed,
      to?.id ?? null,
      assignmentId,
      meta.at,
    );
    await assign._finish(
      tx,
      deps,
      current,
      to,
      changed.length,
      assignmentId,
      meta.ip,
    );
    return { updated: changed.length };
  },

  // Member removal: the caller has locked and checked both members and owns the transaction.
  async reassignOpenLeads(
    tx: TenantTx,
    deps: WriteDeps,
    current: Ctx,
    from: string,
    to: string | null,
    meta: Meta,
  ): Promise<number> {
    const target = to
      ? await assign._activeMember(tx, deps, current, to)
      : null;
    const assignmentId = v7();
    let moved = 0;
    let after: string | null = null;
    for (;;) {
      const batch = await repository.lockOpenLeadsOf(
        tx,
        from,
        after,
        batchSize,
      );
      if (!batch.length) break;
      await assign._write(tx, current, batch, to, assignmentId, meta.at);
      moved += batch.length;
      after = batch[batch.length - 1].id;
    }
    if (moved)
      await assign._finish(
        tx,
        deps,
        current,
        target,
        moved,
        assignmentId,
        meta.ip,
      );
    return moved;
  },

  async _activeMember(
    tx: TenantTx,
    deps: WriteDeps,
    current: Ctx,
    memberId: string | null,
  ): Promise<Member | null> {
    if (!memberId) return null;
    const member = await deps.readMember(tx, current.companyId, memberId, true);
    if (member?.status !== "active")
      throw new AppError("validation", "Choose an active member");
    return member;
  },

  async _write(
    tx: TenantTx,
    current: Ctx,
    rows: Row[],
    to: string | null,
    assignmentId: string,
    at: Date,
  ): Promise<void> {
    await repository.assign(
      tx,
      rows.map((row) => row.id),
      to,
      at,
    );
    await events.insert(
      tx,
      current.companyId,
      {
        actorUserId: current.user.id,
        actorMemberId: current.member?.id ?? null,
      },
      rows.map((row) =>
        to
          ? {
              leadId: row.id,
              type: "assigned" as const,
              data: {
                assignmentId,
                from: row.assignedTo,
                to,
              } satisfies AssignedData,
            }
          : {
              leadId: row.id,
              type: "unassigned" as const,
              data: {
                assignmentId,
                from: row.assignedTo,
                to: null,
              } satisfies UnassignedData,
            },
      ),
    );
  },

  async _finish(
    tx: TenantTx,
    deps: WriteDeps,
    current: Ctx,
    to: Member | null,
    count: number,
    assignmentId: string,
    ip: string | null,
  ): Promise<void> {
    await audit.audit(
      tx,
      {
        user: current.user,
        role: current.role,
        agencyId: current.agencyId,
        companyId: current.companyId,
        ip,
      },
      "leads.assign",
      { type: "company", id: current.companyId },
      { count: String(count), memberId: to?.id ?? "none", assignmentId },
    );
    if (!to) return;
    await deps.notify(tx, {
      companyId: current.companyId,
      userId: to.userId,
      title: "New leads assigned",
      body:
        count === 1
          ? "1 lead was assigned to you."
          : `${count} leads were assigned to you.`,
      url: `/${current.company.slug}/today`,
      dedupeKey: `assign:${current.companyId}:${assignmentId}`,
      data: { type: "assigned", assignmentId, count },
    });
  },
};
export type LeadAssignService = ReturnType<typeof assign.create>;
export default assign;
