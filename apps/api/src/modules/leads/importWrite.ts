import { leads, readCompanyScope, type TenantTx } from "@anar/db/tenant";
import type { ImportInsert, ImportWriteResult } from "@anar/domain/imports";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { v7 } from "uuid";
import events, { type EventActor } from "./events.js";

type Input = { batchId: string; stageId: string; rows: ImportInsert[] };
type Planned = { row: ImportInsert; id: string };

const livePhone = sql`${leads.phoneE164} IS NOT NULL AND ${leads.mergedIntoId} IS NULL AND ${leads.deletedAt} IS NULL`;

const importWrite = {
  // A phone that already has a live lead keeps that lead as it is; only a changed submission gets an event.
  async addImportedLeads(
    tx: TenantTx,
    current: EventActor,
    input: Input,
  ): Promise<ImportWriteResult> {
    const { companyId } = await readCompanyScope(tx);
    if (input.rows.length === 0) return { rows: [] };
    const planned = input.rows.map((row) => ({ row, id: v7() }));
    // Phone order, so two imports sharing phones always wait on each other the same way.
    const ordered = [...planned].sort((a, b) =>
      (a.row.lead.phoneE164 ?? "").localeCompare(b.row.lead.phoneE164 ?? ""),
    );
    const inserted = await tx
      .insert(leads)
      .values(ordered.map((item) => importWrite._lead(item, companyId, input)))
      .onConflictDoNothing({
        target: [leads.companyId, leads.phoneE164],
        where: livePhone,
      })
      .returning({ id: leads.id });
    const ids = new Set(inserted.map((lead) => lead.id));
    const existing = await importWrite._liveLeads(
      tx,
      planned.filter((item) => !ids.has(item.id)),
    );
    const result: ImportWriteResult = { rows: [] };
    const timeline: Parameters<typeof events.insert>[3] = [];
    for (const { row, id } of planned) {
      const { rowNo, lead } = row;
      if (ids.has(id)) {
        result.rows.push({
          rowNo,
          leadId: id,
          result: "imported",
          reason: lead.phoneE164 ? null : "invalid_phone",
        });
        timeline.push({
          leadId: id,
          type: "imported",
          data: { batchId: input.batchId, rowNo },
        });
        continue;
      }
      const match = existing.get(lead.phoneE164 ?? "");
      if (!match) throw new Error("A phone conflict has no live lead");
      const same =
        match.campaignName === lead.campaignName &&
        match.leadDate.getTime() === lead.leadDate.getTime();
      result.rows.push({
        rowNo,
        leadId: match.id,
        result: "duplicate_db",
        reason: same ? "same_submission" : "resubmitted",
      });
      if (!same)
        timeline.push({
          leadId: match.id,
          type: "duplicate_import",
          data: {
            batchId: input.batchId,
            rowNo,
            campaignName: lead.campaignName,
            leadDate: lead.leadDate.toISOString(),
          },
        });
    }
    await events.insert(tx, companyId, current, timeline);
    return result;
  },
  async _liveLeads(tx: TenantTx, lost: Planned[]) {
    if (lost.length === 0) return new Map();
    const rows = await tx
      .select({
        id: leads.id,
        phoneE164: leads.phoneE164,
        campaignName: leads.campaignName,
        leadDate: leads.leadDate,
      })
      .from(leads)
      .where(
        and(
          inArray(
            leads.phoneE164,
            lost.map((item) => item.row.lead.phoneE164 ?? ""),
          ),
          isNull(leads.mergedIntoId),
          isNull(leads.deletedAt),
        ),
      );
    return new Map(rows.map((lead) => [lead.phoneE164 ?? "", lead]));
  },
  _lead({ row, id }: Planned, companyId: string, input: Input) {
    const { lead, score } = row;
    return {
      id,
      companyId,
      fullName: lead.fullName,
      phoneE164: lead.phoneE164,
      phoneRaw: lead.phoneRaw,
      phoneValid: lead.phoneValid,
      email: lead.email,
      source: lead.source,
      sourceKind: "import" as const,
      externalId: lead.externalId,
      leadDate: lead.leadDate,
      campaignName: lead.campaignName,
      formName: lead.formName,
      stageId: input.stageId,
      custom: lead.custom,
      score: score.score,
      priority: score.priority,
      scoreBreakdown: score.breakdown,
      scoredAt: sql`now()`,
      importBatchId: input.batchId,
    };
  },
};
export default importWrite;
