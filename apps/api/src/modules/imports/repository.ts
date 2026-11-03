import {
  importBatches,
  importRows,
  importRuns,
  mappingTemplates,
  type TenantTx,
} from "@anar/db/tenant";
import type {
  CsvProfile,
  ImportDraft,
  Mapping,
  MappingTemplate,
} from "@anar/domain/imports";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { CommitSnapshot, FrozenImport } from "./types.js";

type BatchRow = typeof importBatches.$inferSelect;
export type RunRow = typeof importRuns.$inferSelect;
type RowFilter = "all" | "exceptions" | "phone_review";
type StoredProfile = Omit<CsvProfile, "dateRange"> & {
  dateRange: { from: string; to: string } | null;
};
export type StoredDraft = Omit<ImportDraft, "batchId" | "revision"> & {
  snapshot?: CommitSnapshot;
};
export type StoredBatch = Omit<BatchRow, "profile" | "draft" | "frozen"> & {
  profile: CsvProfile;
  draft: StoredDraft | null;
  frozen: FrozenImport | null;
};

const repository = {
  async insertBatch(
    tx: TenantTx,
    row: Omit<typeof importBatches.$inferInsert, "profile"> & {
      profile: CsvProfile;
    },
  ): Promise<void> {
    await tx
      .insert(importBatches)
      .values({ ...row, profile: repository._storeProfile(row.profile) });
  },
  readBatch(tx: TenantTx, id: string): Promise<StoredBatch | null> {
    return repository._read(tx, id, false);
  },
  lockBatch(tx: TenantTx, id: string): Promise<StoredBatch | null> {
    return repository._read(tx, id, true);
  },
  async saveDraft(
    tx: TenantTx,
    id: string,
    draft: StoredDraft,
    revision: number,
  ): Promise<void> {
    await tx
      .update(importBatches)
      .set({ draft, previewRevision: revision, updatedAt: sql`now()` })
      .where(eq(importBatches.id, id));
  },
  async _read(
    tx: TenantTx,
    id: string,
    lock: boolean,
  ): Promise<StoredBatch | null> {
    const query = tx
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, id));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) return null;
    const stored = row.profile as StoredProfile;
    const range = stored.dateRange;
    return {
      ...row,
      draft: row.draft as StoredDraft | null,
      frozen: row.frozen as FrozenImport | null,
      profile: {
        ...stored,
        dateRange: range && {
          from: new Date(range.from),
          to: new Date(range.to),
        },
      },
    };
  },
  // Phones already claimed by earlier rows of this batch; invalid rows never claim one.
  async claimedPhones(
    tx: TenantTx,
    batchId: string,
    phones: string[],
  ): Promise<Set<string>> {
    if (phones.length === 0) return new Set();
    const rows = await tx
      .selectDistinct({ phone: importRows.phoneE164 })
      .from(importRows)
      .where(
        and(
          eq(importRows.batchId, batchId),
          inArray(importRows.phoneE164, phones),
          notInArray(importRows.result, ["invalid", "error"]),
        ),
      );
    return new Set(rows.map((row) => row.phone ?? ""));
  },
  async insertRows(
    tx: TenantTx,
    rows: (typeof importRows.$inferInsert)[],
  ): Promise<void> {
    await tx.insert(importRows).values(rows);
  },
  async updateBatch(
    tx: TenantTx,
    id: string,
    set: Partial<typeof importBatches.$inferInsert>,
  ): Promise<void> {
    await tx
      .update(importBatches)
      .set({ ...set, updatedAt: sql`now()` })
      .where(eq(importBatches.id, id));
  },
  async lockRun(tx: TenantTx, id: string): Promise<RunRow | null> {
    const [row] = await tx
      .select()
      .from(importRuns)
      .where(eq(importRuns.id, id))
      .for("update");
    return row ?? null;
  },
  async readRun(tx: TenantTx, id: string): Promise<RunRow | null> {
    const [row] = await tx
      .select()
      .from(importRuns)
      .where(eq(importRuns.id, id));
    return row ?? null;
  },
  async listRows(
    tx: TenantTx,
    batchId: string,
    filter: RowFilter,
    afterRowNo: number,
    limit: number,
  ) {
    return tx
      .select()
      .from(importRows)
      .where(
        and(
          eq(importRows.batchId, batchId),
          gt(importRows.rowNo, afterRowNo),
          repository._filter(filter),
        ),
      )
      .orderBy(asc(importRows.rowNo))
      .limit(limit);
  },
  async countRows(
    tx: TenantTx,
    batchId: string,
    filter: RowFilter,
  ): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(importRows)
      .where(and(eq(importRows.batchId, batchId), repository._filter(filter)));
    return row.count;
  },
  // Exceptions are every row that was not a clean new lead, including new leads whose phone needs review.
  _filter(filter: RowFilter) {
    if (filter === "all") return undefined;
    const review = eq(importRows.reason, "invalid_phone");
    return filter === "phone_review"
      ? review
      : or(ne(importRows.result, "imported"), review);
  },
  async updateRun(
    tx: TenantTx,
    id: string,
    set: Partial<typeof importRuns.$inferInsert>,
  ): Promise<void> {
    await tx
      .update(importRuns)
      .set({ ...set, updatedAt: sql`now()` })
      .where(eq(importRuns.id, id));
  },
  async countResults(tx: TenantTx, batchId: string) {
    return tx
      .select({
        result: importRows.result,
        reason: importRows.reason,
        count: sql<number>`count(*)::int`,
      })
      .from(importRows)
      .where(eq(importRows.batchId, batchId))
      .groupBy(importRows.result, importRows.reason);
  },
  async insertRun(
    tx: TenantTx,
    row: typeof importRuns.$inferInsert,
  ): Promise<void> {
    await tx.insert(importRuns).values(row);
  },
  // A saved name replaces the template for these headers; otherwise only its last use moves.
  async useTemplate(
    tx: TenantTx,
    row: typeof mappingTemplates.$inferInsert,
    save: boolean,
  ): Promise<string | null> {
    const [saved] = save
      ? await tx
          .insert(mappingTemplates)
          .values(row)
          .onConflictDoUpdate({
            target: [
              mappingTemplates.companyId,
              mappingTemplates.headerFingerprint,
            ],
            set: {
              name: row.name,
              headers: row.headers,
              mapping: row.mapping,
              lastUsedAt: row.lastUsedAt,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: mappingTemplates.id })
      : await tx
          .update(mappingTemplates)
          .set({ lastUsedAt: row.lastUsedAt, updatedAt: sql`now()` })
          .where(eq(mappingTemplates.headerFingerprint, row.headerFingerprint))
          .returning({ id: mappingTemplates.id });
    return saved?.id ?? null;
  },
  async listTemplates(tx: TenantTx): Promise<MappingTemplate[]> {
    const rows = await tx.select().from(mappingTemplates);
    return rows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      headerFingerprint: row.headerFingerprint,
      headers: row.headers,
      mapping: row.mapping as Mapping,
      formName: row.formName,
      campaignName: row.campaignName,
      createdBy: row.createdBy,
      lastUsedAt: row.lastUsedAt,
    }));
  },
  _storeProfile(profile: CsvProfile): StoredProfile {
    const range = profile.dateRange;
    return {
      ...profile,
      dateRange: range && {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
    };
  },
};
export default repository;
