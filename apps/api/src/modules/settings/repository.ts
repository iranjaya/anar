import {
  fields,
  lostReasons,
  outcomes,
  stages,
  type TenantTx,
} from "@anar/db/tenant";
import type { Field, SettingsCatalog } from "@anar/domain/settings";
import { asc, eq, inArray, isNull, sql } from "drizzle-orm";

const fieldColumns = {
  id: fields.id,
  companyId: fields.companyId,
  key: fields.key,
  label: fields.label,
  type: fields.type,
  options: fields.options,
  isSystem: fields.isSystem,
  position: fields.position,
  archivedAt: fields.archivedAt,
};

const repository = {
  // Ordered by position then ID; archived rows only when the editor asks for them.
  async catalog(tx: TenantTx, activeOnly: boolean): Promise<SettingsCatalog> {
    const fieldRows = await tx
      .select(fieldColumns)
      .from(fields)
      .where(activeOnly ? isNull(fields.archivedAt) : undefined)
      .orderBy(asc(fields.position), asc(fields.id));
    const stageRows = await tx
      .select({
        id: stages.id,
        companyId: stages.companyId,
        name: stages.name,
        position: stages.position,
        kind: stages.kind,
        isDefault: stages.isDefault,
        archivedAt: stages.archivedAt,
      })
      .from(stages)
      .where(activeOnly ? isNull(stages.archivedAt) : undefined)
      .orderBy(asc(stages.position), asc(stages.id));
    const outcomeRows = await tx
      .select({
        id: outcomes.id,
        companyId: outcomes.companyId,
        name: outcomes.name,
        countsAsFailed: outcomes.countsAsFailed,
        position: outcomes.position,
        archivedAt: outcomes.archivedAt,
      })
      .from(outcomes)
      .where(activeOnly ? isNull(outcomes.archivedAt) : undefined)
      .orderBy(asc(outcomes.position), asc(outcomes.id));
    const reasonRows = await tx
      .select({
        id: lostReasons.id,
        companyId: lostReasons.companyId,
        name: lostReasons.name,
        position: lostReasons.position,
        archivedAt: lostReasons.archivedAt,
      })
      .from(lostReasons)
      .where(activeOnly ? isNull(lostReasons.archivedAt) : undefined)
      .orderBy(asc(lostReasons.position), asc(lostReasons.id));
    return {
      fields: fieldRows,
      stages: stageRows,
      outcomes: outcomeRows,
      lostReasons: reasonRows,
    };
  },
  async fieldKeys(tx: TenantTx): Promise<string[]> {
    const rows = await tx.select({ key: fields.key }).from(fields);
    return rows.map((row) => row.key);
  },
  async nextFieldPosition(tx: TenantTx): Promise<number> {
    const [row] = await tx
      .select({ next: sql<number>`coalesce(max(${fields.position}) + 1, 0)` })
      .from(fields);
    return Number(row.next);
  },
  async insertFields(
    tx: TenantTx,
    rows: (typeof fields.$inferInsert)[],
  ): Promise<Field[]> {
    const inserted = await tx
      .insert(fields)
      .values(rows)
      .returning(fieldColumns);
    return inserted.sort((a, b) => a.position - b.position);
  },
  async lockField(tx: TenantTx, fieldId: string) {
    const [row] = await tx
      .select()
      .from(fields)
      .where(eq(fields.id, fieldId))
      .for("update");
    return row;
  },
  lockFieldsByKey(tx: TenantTx, keys: string[]) {
    return tx
      .select()
      .from(fields)
      .where(inArray(fields.key, keys))
      .orderBy(asc(fields.id))
      .for("update");
  },
  lockOutcomes(tx: TenantTx) {
    return tx.select().from(outcomes).for("update");
  },
  async insertOutcome(
    tx: TenantTx,
    row: typeof outcomes.$inferInsert,
  ): Promise<void> {
    await tx.insert(outcomes).values(row);
  },
  async updateOutcome(
    tx: TenantTx,
    outcomeId: string,
    set: Partial<typeof outcomes.$inferInsert>,
  ): Promise<void> {
    await tx.update(outcomes).set(set).where(eq(outcomes.id, outcomeId));
  },
  lockLostReasons(tx: TenantTx) {
    return tx.select().from(lostReasons).for("update");
  },
  async insertLostReason(
    tx: TenantTx,
    row: typeof lostReasons.$inferInsert,
  ): Promise<void> {
    await tx.insert(lostReasons).values(row);
  },
  async updateLostReason(
    tx: TenantTx,
    lostReasonId: string,
    set: Partial<typeof lostReasons.$inferInsert>,
  ): Promise<void> {
    await tx
      .update(lostReasons)
      .set(set)
      .where(eq(lostReasons.id, lostReasonId));
  },
  lockStages(tx: TenantTx) {
    return tx.select().from(stages).for("update");
  },
  async insertStage(
    tx: TenantTx,
    row: typeof stages.$inferInsert,
  ): Promise<void> {
    await tx.insert(stages).values(row);
  },
  async updateStage(
    tx: TenantTx,
    stageId: string,
    set: Partial<typeof stages.$inferInsert>,
  ): Promise<void> {
    await tx.update(stages).set(set).where(eq(stages.id, stageId));
  },
  async updateField(
    tx: TenantTx,
    fieldId: string,
    set: Partial<typeof fields.$inferInsert>,
  ): Promise<void> {
    await tx.update(fields).set(set).where(eq(fields.id, fieldId));
  },
};
export default repository;
