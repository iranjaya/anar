import { companies } from "@anar/db/platform";
import { readCompanyScope, setSchedulerCatalogScope } from "@anar/db/tenant";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import periods from "../../src/modules/followups/periods.js";
import tenant from "../../src/modules/tenant/index.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

describe("system tenant transactions", () => {
  let fixture: CompanyFixture;
  let system: Awaited<ReturnType<typeof tenant.startSystem>>;
  beforeAll(async () => {
    fixture = await startCompanyFixture();
    system = await tenant.startSystem(fixture.postgres.appUrl);
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await system?.close();
    await fixture?.close();
  });

  it("sees only the given company, as the system actor", async () => {
    const { a, b } = await fixture.setup();
    const seen = await system.withSystemTenant(
      { agencyId: a.agencyId, companyId: a.companyId, authority: "scheduler" },
      async (tx) => ({
        companies: (await tx.select({ id: companies.id }).from(companies)).map(
          (row) => row.id,
        ),
        userId: (
          await tx.execute<{ user_id: string }>(
            sql`select current_setting('app.user_id', true) as user_id`,
          )
        ).rows[0]?.user_id,
        actorKind: (
          await tx.execute<{ actor_kind: string }>(
            sql`select current_setting('app.actor_kind', true) as actor_kind`,
          )
        ).rows[0]?.actor_kind,
        scope: await readCompanyScope(tx),
      }),
    );
    expect(seen).toEqual({
      companies: [a.companyId],
      userId: "",
      actorKind: "scheduler",
      scope: {
        agencyId: a.agencyId,
        companyId: a.companyId,
        userId: null,
        authority: "scheduler",
      },
    });
    expect(seen.companies).not.toContain(b.companyId);
  });

  it("lists only active company IDs through the scheduler catalog", async () => {
    const { a, b } = await fixture.setup();
    const ids = await fixture.db.transaction(async (tx) => {
      await setSchedulerCatalogScope(tx);
      return (await tx.select({ id: companies.id }).from(companies)).map(
        (row) => row.id,
      );
    });
    expect(ids).toEqual(expect.arrayContaining([a.companyId, b.companyId]));
  });

  it("keeps an overdue cursor and original local date after reopening", async () => {
    const { a } = await fixture.setup();
    const scope = {
      agencyId: a.agencyId,
      companyId: a.companyId,
      authority: "scheduler",
    } as const;
    const slot = "2026-11-02T00:00:00.000Z";
    const first = await system.withSystemTenant(scope, async (tx) => {
      const opened = await periods.openPeriod(tx, {
        slot,
        at: new Date(slot),
        timezone: "Asia/Kathmandu",
        localDate: "2026-11-02",
      });
      await periods.checkpointPeriod(tx, {
        slot,
        cursor: "70000000-0000-4000-8000-000000000001",
        done: false,
      });
      return opened;
    });
    expect(first?.localDate).toBe("2026-11-02");
    const resumed = await system.withSystemTenant(scope, (tx) =>
      periods.openPeriod(tx, {
        slot,
        at: new Date("2026-11-03T00:00:00.000Z"),
        timezone: "UTC",
        localDate: "2026-11-03",
      }),
    );
    expect(resumed).toEqual({
      at: new Date(slot),
      timezone: "Asia/Kathmandu",
      localDate: "2026-11-02",
      cursor: "70000000-0000-4000-8000-000000000001",
    });
  });

  it("refuses a company from another agency", async () => {
    const { a, b } = await fixture.setup();
    await expect(
      system.withSystemTenant(
        {
          agencyId: a.agencyId,
          companyId: b.companyId,
          authority: "scheduler",
        },
        async () => "ran",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
