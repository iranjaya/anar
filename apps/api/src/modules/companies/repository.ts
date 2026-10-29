import { companies, type PlatformTx } from "@anar/db/platform";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";

const repository = {
  async readActive(
    tx: PlatformTx,
    agencyId: string,
    companyId: string,
    lock: boolean,
  ) {
    const query = tx
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.agencyId, agencyId),
          eq(companies.id, companyId),
          eq(companies.status, "active"),
        ),
      );
    const [company] = await (lock ? query.for("update") : query);
    return company;
  },
  async create(tx: PlatformTx, input: typeof companies.$inferInsert) {
    const [company] = await tx
      .insert(companies)
      .values(input)
      .onConflictDoNothing({ target: companies.slug })
      .returning({ companyId: companies.id });
    return company;
  },
  async listSummaries(
    tx: PlatformTx,
    agencyId: string,
    cursor?: { createdAt: Date; id: string },
  ) {
    return tx
      .select({
        id: companies.id,
        createdAt: companies.createdAt,
        summary: {
          id: companies.id,
          agencyId: companies.agencyId,
          name: companies.name,
          slug: companies.slug,
          status: companies.status,
          defaultCountry: companies.defaultCountry,
          timezone: companies.timezone,
          leadCount: sql<number>`0::integer`,
          lastImportAt: sql<Date | null>`null::timestamptz`,
        },
      })
      .from(companies)
      .where(
        and(
          eq(companies.agencyId, agencyId),
          cursor
            ? or(
                lt(companies.createdAt, cursor.createdAt),
                and(
                  eq(companies.createdAt, cursor.createdAt),
                  lt(companies.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(companies.createdAt), desc(companies.id))
      .limit(51);
  },
};
export default repository;
