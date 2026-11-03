import {
  companyMembers,
  leadEvents,
  leads,
  stages,
  type TenantTx,
} from "@anar/db/tenant";
import type { Priority } from "@anar/domain/leads";
import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { Cursor } from "./cursor.js";

export type QueueFilter = {
  assignedTo: string | "unassigned" | null;
  priority: Priority | null;
  stageId: string | null;
  name: string | null;
  phonePrefix: string | null;
};

const repository = {
  lockLiveLeads(tx: TenantTx, ids: string[]) {
    return tx
      .select({ id: leads.id, assignedTo: leads.assignedTo })
      .from(leads)
      .where(
        and(
          inArray(leads.id, ids),
          isNull(leads.mergedIntoId),
          isNull(leads.deletedAt),
        ),
      )
      .orderBy(asc(leads.id))
      .for("update");
  },

  lockOpenLeadsOf(
    tx: TenantTx,
    memberId: string,
    afterId: string | null,
    limit: number,
  ) {
    return tx
      .select({ id: leads.id, assignedTo: leads.assignedTo })
      .from(leads)
      .innerJoin(
        stages,
        and(
          eq(stages.companyId, leads.companyId),
          eq(stages.id, leads.stageId),
        ),
      )
      .where(
        and(
          eq(leads.assignedTo, memberId),
          eq(stages.kind, "open"),
          isNull(leads.mergedIntoId),
          isNull(leads.deletedAt),
          afterId ? gt(leads.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(leads.id))
      .limit(limit)
      .for("update", { of: leads });
  },

  async assign(
    tx: TenantTx,
    ids: string[],
    memberId: string | null,
    at: Date,
  ): Promise<void> {
    await tx
      .update(leads)
      .set({ assignedTo: memberId, updatedAt: at })
      .where(inArray(leads.id, ids));
  },

  async readLiveLead(tx: TenantTx, id: string, lock = false) {
    const query = tx
      .select(repository._leadColumns())
      .from(leads)
      .where(
        and(
          eq(leads.id, id),
          isNull(leads.mergedIntoId),
          isNull(leads.deletedAt),
        ),
      );
    const [row] = await (lock ? query.for("update") : query);
    return row;
  },

  async hasLivePhone(
    tx: TenantTx,
    phoneE164: string,
    exceptId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(
        and(
          eq(leads.phoneE164, phoneE164),
          ne(leads.id, exceptId),
          isNull(leads.mergedIntoId),
          isNull(leads.deletedAt),
        ),
      );
    return Boolean(row);
  },

  async updateLead(
    tx: TenantTx,
    id: string,
    set: Partial<typeof leads.$inferInsert>,
  ) {
    const [row] = await tx
      .update(leads)
      .set(set)
      .where(eq(leads.id, id))
      .returning(repository._leadColumns());
    return row;
  },

  _leadColumns() {
    const { updatedAt: _updatedAt, ...columns } = getTableColumns(leads);
    return columns;
  },

  listEvents(
    tx: TenantTx,
    leadId: string,
    cursor: Cursor | null,
    limit: number,
  ) {
    const { updatedAt: _updatedAt, ...columns } = getTableColumns(leadEvents);
    return tx
      .select(columns)
      .from(leadEvents)
      .where(
        and(
          eq(leadEvents.leadId, leadId),
          cursor
            ? or(
                lt(leadEvents.createdAt, cursor.at),
                and(
                  eq(leadEvents.createdAt, cursor.at),
                  lt(leadEvents.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        sql`${leadEvents.createdAt} desc nulls last`,
        sql`${leadEvents.id} desc nulls last`,
      )
      .limit(limit);
  },

  listQueue(
    tx: TenantTx,
    filter: QueueFilter,
    cursor: Cursor | null,
    limit: number,
  ) {
    return (
      tx
        .select({
          id: leads.id,
          fullName: leads.fullName,
          phoneE164: leads.phoneE164,
          phoneValid: leads.phoneValid,
          priority: leads.priority,
          score: leads.score,
          nextActionAt: leads.nextActionAt,
          failedAttempts: leads.failedAttempts,
          source: leads.source,
          leadDate: leads.leadDate,
          custom: leads.custom,
          stage: { id: stages.id, name: stages.name, kind: stages.kind },
          assigneeId: companyMembers.id,
          assigneeName: companyMembers.name,
        })
        .from(leads)
        .innerJoin(
          stages,
          and(
            eq(stages.companyId, leads.companyId),
            eq(stages.id, leads.stageId),
          ),
        )
        .leftJoin(
          companyMembers,
          and(
            eq(companyMembers.companyId, leads.companyId),
            eq(companyMembers.id, leads.assignedTo),
          ),
        )
        .where(and(repository._where(filter), repository._after(cursor)))
        // Matches leads_lead_date_idx exactly, so a page reads straight from the index.
        .orderBy(sql`${leads.leadDate} desc nulls last`, asc(leads.id))
        .limit(limit)
    );
  },

  async countQueue(tx: TenantTx, filter: QueueFilter): Promise<number> {
    const [row] = await tx
      .select({ total: count() })
      .from(leads)
      .where(repository._where(filter));
    return row.total;
  },

  _where(filter: QueueFilter): SQL | undefined {
    const assigned =
      filter.assignedTo === "unassigned"
        ? isNull(leads.assignedTo)
        : filter.assignedTo && eq(leads.assignedTo, filter.assignedTo);
    const search = or(
      filter.name
        ? sql`${leads.fullName} ILIKE ${`%${repository._escape(filter.name)}%`}`
        : undefined,
      filter.phonePrefix
        ? sql`${leads.phoneE164} ~>=~ ${filter.phonePrefix} AND ${leads.phoneE164} ~<~ ${repository._prefixEnd(filter.phonePrefix)}`
        : undefined,
    );
    return and(
      isNull(leads.mergedIntoId),
      isNull(leads.deletedAt),
      assigned || undefined,
      filter.priority ? eq(leads.priority, filter.priority) : undefined,
      filter.stageId ? eq(leads.stageId, filter.stageId) : undefined,
      search,
    );
  },

  _after(cursor: Cursor | null): SQL | undefined {
    if (!cursor) return undefined;
    return or(
      lt(leads.leadDate, cursor.at),
      and(eq(leads.leadDate, cursor.at), gt(leads.id, cursor.id)),
    );
  },

  // LIKE cannot use an index under row security, so a prefix is read as the range up to its next value.
  _prefixEnd(prefix: string): string {
    return (
      prefix.slice(0, -1) +
      String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)
    );
  },

  // ILIKE's default escape character is the backslash.
  _escape(value: string): string {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
  },
};
export default repository;
