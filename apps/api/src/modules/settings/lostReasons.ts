import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  lostReasonIdSchema,
  lostReasonInputSchema,
} from "@anar/domain/settings";
import { v7 } from "uuid";
import audit from "../tenant/audit.js";
import type { Ctx } from "../tenant/index.js";
import guard, { type Meta } from "./guard.js";
import repository from "./repository.js";

const lostReasons = {
  async upsertLostReason(
    tx: TenantTx,
    current: Ctx,
    input: unknown,
    meta: Meta,
  ): Promise<{ ok: true }> {
    guard.manage(current, meta);
    const parsed = lostReasonInputSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError("validation", "Check the reason name");
    const { id, name } = parsed.data;
    const rows = await repository.lockLostReasons(tx);
    const target = id ? rows.find((row) => row.id === id) : undefined;
    if (id && !target) throw new AppError("not_found", "Lost reason not found");
    if (target?.archivedAt)
      throw new AppError("conflict", "Archived reasons cannot change");
    if (rows.some((row) => row.id !== id && row.name === name))
      throw new AppError("conflict", "Another reason already has this name");
    const lostReasonId = target?.id ?? v7();
    if (target)
      await repository.updateLostReason(tx, lostReasonId, {
        name,
        updatedAt: meta.at,
      });
    else
      await repository.insertLostReason(tx, {
        id: lostReasonId,
        companyId: current.companyId,
        name,
        position: Math.max(-1, ...rows.map((row) => row.position)) + 1,
      });
    await audit.audit(
      tx,
      guard.actor(current, meta),
      "settings.reason_saved",
      { type: "lost_reason", id: lostReasonId },
      { lostReasonId },
    );
    return { ok: true };
  },
  async archiveLostReason(
    tx: TenantTx,
    current: Ctx,
    input: unknown,
    meta: Meta,
  ): Promise<{ ok: true }> {
    guard.manage(current, meta);
    const parsed = lostReasonIdSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError("validation", "Choose a reason to archive");
    const { lostReasonId } = parsed.data;
    const rows = await repository.lockLostReasons(tx);
    const target = rows.find((row) => row.id === lostReasonId);
    if (!target) throw new AppError("not_found", "Lost reason not found");
    if (target.archivedAt) return { ok: true };
    if (!rows.some((row) => row.id !== lostReasonId && row.archivedAt === null))
      throw new AppError("conflict", "Keep at least one lost reason");
    await repository.updateLostReason(tx, lostReasonId, {
      archivedAt: meta.at,
      updatedAt: meta.at,
    });
    await audit.audit(
      tx,
      guard.actor(current, meta),
      "settings.reason_archived",
      { type: "lost_reason", id: lostReasonId },
      { lostReasonId },
    );
    return { ok: true };
  },
};
export default lostReasons;
