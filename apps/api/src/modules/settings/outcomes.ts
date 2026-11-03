import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import { outcomeIdSchema, outcomeInputSchema } from "@anar/domain/settings";
import { v7 } from "uuid";
import audit from "../tenant/audit.js";
import type { Ctx } from "../tenant/index.js";
import guard, { type Meta } from "./guard.js";
import repository from "./repository.js";

const outcomes = {
  // A changed failed flag only counts for calls logged after it; past calls keep their counts.
  async upsertOutcome(
    tx: TenantTx,
    current: Ctx,
    input: unknown,
    meta: Meta,
  ): Promise<{ ok: true }> {
    guard.manage(current, meta);
    const parsed = outcomeInputSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError("validation", "Check the outcome name");
    const { id, name, countsAsFailed } = parsed.data;
    const rows = await repository.lockOutcomes(tx);
    const target = id ? rows.find((row) => row.id === id) : undefined;
    if (id && !target) throw new AppError("not_found", "Outcome not found");
    if (target?.archivedAt)
      throw new AppError("conflict", "Archived outcomes cannot change");
    if (rows.some((row) => row.id !== id && row.name === name))
      throw new AppError("conflict", "Another outcome already has this name");
    const outcomeId = target?.id ?? v7();
    if (target)
      await repository.updateOutcome(tx, outcomeId, {
        name,
        countsAsFailed,
        updatedAt: meta.at,
      });
    else
      await repository.insertOutcome(tx, {
        id: outcomeId,
        companyId: current.companyId,
        name,
        countsAsFailed,
        position: Math.max(-1, ...rows.map((row) => row.position)) + 1,
      });
    await audit.audit(
      tx,
      guard.actor(current, meta),
      "settings.outcome_saved",
      { type: "outcome", id: outcomeId },
      { outcomeId },
    );
    return { ok: true };
  },
  async archiveOutcome(
    tx: TenantTx,
    current: Ctx,
    input: unknown,
    meta: Meta,
  ): Promise<{ ok: true }> {
    guard.manage(current, meta);
    const parsed = outcomeIdSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError("validation", "Choose an outcome to archive");
    const { outcomeId } = parsed.data;
    const rows = await repository.lockOutcomes(tx);
    const target = rows.find((row) => row.id === outcomeId);
    if (!target) throw new AppError("not_found", "Outcome not found");
    if (target.archivedAt) return { ok: true };
    if (!rows.some((row) => row.id !== outcomeId && row.archivedAt === null))
      throw new AppError("conflict", "Keep at least one call outcome");
    await repository.updateOutcome(tx, outcomeId, {
      archivedAt: meta.at,
      updatedAt: meta.at,
    });
    await audit.audit(
      tx,
      guard.actor(current, meta),
      "settings.outcome_archived",
      { type: "outcome", id: outcomeId },
      { outcomeId },
    );
    return { ok: true };
  },
};
export default outcomes;
