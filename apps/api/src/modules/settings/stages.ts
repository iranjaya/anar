import type { stages as stageTable, TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  reorderStagesSchema,
  stageIdSchema,
  stageInputSchema,
} from "@anar/domain/settings";
import { v7 } from "uuid";
import audit from "../tenant/audit.js";
import type { Ctx } from "../tenant/index.js";
import type { SettingsReferenceReader } from "./fields.js";
import guard, { type Meta } from "./guard.js";
import repository from "./repository.js";

type StageRow = typeof stageTable.$inferSelect;

const stages = {
  async upsertStage(
    tx: TenantTx,
    current: Ctx,
    input: unknown,
    meta: Meta,
    references: SettingsReferenceReader,
  ): Promise<{ ok: true }> {
    guard.manage(current, meta);
    const parsed = stageInputSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError("validation", "Check the stage name and type");
    const { id, name, kind, isDefault } = parsed.data;
    const rows = await repository.lockStages(tx);
    const target = id ? rows.find((row) => row.id === id) : undefined;
    if (id && !target) throw new AppError("not_found", "Stage not found");
    if (target?.archivedAt)
      throw new AppError("conflict", "Archived stages cannot change");
    if (rows.some((row) => row.id !== id && row.name === name))
      throw new AppError("conflict", "Another stage already has this name");
    if (isDefault && kind !== "open")
      throw new AppError("conflict", "The default stage must be an open stage");
    if (target?.isDefault && !isDefault)
      throw new AppError("conflict", "Choose another default stage first");
    if (target && target.kind !== kind)
      await stages._requireKindChange(tx, rows, target, references);

    const stageId = target?.id ?? v7();
    const previous = rows.find((row) => row.isDefault && row.id !== stageId);
    if (isDefault && previous)
      await repository.updateStage(tx, previous.id, {
        isDefault: false,
        updatedAt: meta.at,
      });
    if (target)
      await repository.updateStage(tx, stageId, {
        name,
        kind,
        isDefault,
        updatedAt: meta.at,
      });
    else
      await repository.insertStage(tx, {
        id: stageId,
        companyId: current.companyId,
        name,
        kind,
        isDefault,
        position: Math.max(-1, ...rows.map((row) => row.position)) + 1,
      });
    await audit.audit(
      tx,
      guard.actor(current, meta),
      "settings.stage_saved",
      { type: "stage", id: stageId },
      { stageId },
    );
    return { ok: true };
  },
  async reorderStages(
    tx: TenantTx,
    current: Ctx,
    input: unknown,
    meta: Meta,
  ): Promise<{ ok: true }> {
    guard.manage(current, meta);
    const parsed = reorderStagesSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError("validation", "Send every stage once, in order");
    const { stageIds } = parsed.data;
    const active = (await repository.lockStages(tx))
      .filter((row) => row.archivedAt === null)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const known = new Set(active.map((row) => row.id));
    if (
      stageIds.length !== active.length ||
      stageIds.some((stageId) => !known.has(stageId))
    )
      throw new AppError(
        "conflict",
        "The stages changed. Reload and try again",
      );
    const unchanged = stageIds.every(
      (stageId, index) =>
        active[index].id === stageId && active[index].position === index,
    );
    if (unchanged) return { ok: true };
    for (const [index, stageId] of stageIds.entries())
      await repository.updateStage(tx, stageId, {
        position: index,
        updatedAt: meta.at,
      });
    await audit.audit(
      tx,
      guard.actor(current, meta),
      "settings.stages_reordered",
      { type: "company", id: current.companyId },
      { count: String(stageIds.length) },
    );
    return { ok: true };
  },
  async archiveStage(
    tx: TenantTx,
    current: Ctx,
    input: unknown,
    meta: Meta,
    references: SettingsReferenceReader,
  ): Promise<{ ok: true }> {
    guard.manage(current, meta);
    const parsed = stageIdSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError("validation", "Choose a stage to archive");
    const rows = await repository.lockStages(tx);
    const target = rows.find((row) => row.id === parsed.data.stageId);
    if (!target) throw new AppError("not_found", "Stage not found");
    if (target.archivedAt) return { ok: true };
    if (target.isDefault)
      throw new AppError("conflict", "Choose another default stage first");
    stages._requireEnding(rows, target);
    const { leadCount } = await references(tx, {
      kind: "stage",
      stageId: target.id,
    });
    if (leadCount > 0)
      throw new AppError(
        "conflict",
        "Leads are on this stage. Move them before archiving it",
      );
    await repository.updateStage(tx, target.id, {
      archivedAt: meta.at,
      updatedAt: meta.at,
    });
    await audit.audit(
      tx,
      guard.actor(current, meta),
      "settings.stage_archived",
      { type: "stage", id: target.id },
      { stageId: target.id },
    );
    return { ok: true };
  },
  // The call form always needs one active won and one active lost stage to end a lead.
  _requireEnding(rows: StageRow[], leaving: StageRow): void {
    if (
      leaving.kind !== "open" &&
      !rows.some(
        (row) =>
          row.id !== leaving.id &&
          row.kind === leaving.kind &&
          row.archivedAt === null,
      )
    )
      throw new AppError(
        "conflict",
        `Keep at least one active ${leaving.kind} stage`,
      );
  },
  async _requireKindChange(
    tx: TenantTx,
    rows: StageRow[],
    target: StageRow,
    references: SettingsReferenceReader,
  ): Promise<void> {
    stages._requireEnding(rows, target);
    const { leadCount } = await references(tx, {
      kind: "stage",
      stageId: target.id,
    });
    if (leadCount > 0)
      throw new AppError(
        "conflict",
        "Leads are on this stage, so its type cannot change",
      );
  },
};
export default stages;
