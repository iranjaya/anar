import {
  companies,
  createPlatformDb,
  type PlatformTx,
} from "@anar/db/platform";
import { setSchedulerCatalogScope } from "@anar/db/tenant";
import { asc, gt } from "drizzle-orm";
import dates from "../../lib/dates.js";
import { enqueue } from "../../lib/jobs/index.js";

type ScheduledCompany = {
  agencyId: string;
  companyId: string;
  timezone: string;
};

async function once(send: () => Promise<string>): Promise<void> {
  try {
    await send();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Queue refused the job")
      throw error;
  }
}

export function dueSummaryPeriods(at: Date, timezone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(at),
  );
  if (hour < 8) return null;
  return {
    localDate: dates.localDate(at, timezone),
    weekStart: dates.previousLocalWeekBounds(at, timezone).weekStart,
  };
}

// The catalog scope can see active company identifiers, never tenant rows.
const scheduler = {
  async start(connectionString: string) {
    const db = await createPlatformDb(connectionString);
    return {
      close: db.close,
      async enqueueOverdue(slot: string): Promise<void> {
        await scheduler._forEachCompany(db, (tx, row) =>
          once(() =>
            enqueue(
              tx,
              "followups.overdue_scan",
              { agencyId: row.agencyId, companyId: row.companyId, slot },
              `overdue-scan:${row.companyId}:${slot}`,
            ),
          ),
        );
      },
      async enqueueSummaries(at: Date): Promise<void> {
        await scheduler._forEachCompany(db, async (tx, row) => {
          const due = dueSummaryPeriods(at, row.timezone);
          if (!due) return;
          await once(() =>
            enqueue(
              tx,
              "reports.summary",
              {
                agencyId: row.agencyId,
                companyId: row.companyId,
                period: "daily",
                localDate: due.localDate,
              },
              `daily:${row.companyId}:${due.localDate}`,
            ),
          );
          await once(() =>
            enqueue(
              tx,
              "reports.summary",
              {
                agencyId: row.agencyId,
                companyId: row.companyId,
                period: "weekly",
                localDate: due.weekStart,
              },
              `weekly:${row.companyId}:${due.weekStart}`,
            ),
          );
        });
      },
    };
  },
  async _forEachCompany(
    db: Awaited<ReturnType<typeof createPlatformDb>>,
    visit: (tx: PlatformTx, company: ScheduledCompany) => Promise<void>,
  ): Promise<void> {
    let cursor: string | null = null;
    for (;;) {
      const next = await db.transaction(async (tx) => {
        await setSchedulerCatalogScope(tx);
        const rows = await tx
          .select({
            agencyId: companies.agencyId,
            companyId: companies.id,
            timezone: companies.timezone,
          })
          .from(companies)
          .where(cursor ? gt(companies.id, cursor) : undefined)
          .orderBy(asc(companies.id))
          .limit(100);
        for (const row of rows) await visit(tx, row);
        return rows.length === 100 ? (rows.at(-1)?.companyId ?? null) : null;
      });
      if (!next) break;
      cursor = next;
    }
  },
};
export default scheduler;
