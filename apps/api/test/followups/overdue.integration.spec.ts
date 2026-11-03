import {
  companyJobPeriods,
  companyMembers,
  leads,
  notifications,
  stages,
} from "@anar/db/tenant";
import { and, eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import overdue from "../../src/modules/followups/overdue.js";
import periods from "../../src/modules/followups/periods.js";
import due from "../../src/modules/leads/due.js";
import tenant from "../../src/modules/tenant/index.js";
import recipients from "../../src/modules/tenant/recipients.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

const leadId = (n: number) =>
  `70000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

describe("overdue scan resume", () => {
  let fixture: SettingsFixture;
  beforeAll(async () => {
    fixture = await startSettingsFixture();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  it("orders by lead ID and resumes a failed page without duplicates or gaps", async () => {
    const { a, seller } = await fixture.setup();
    const catalog = await fixture.scoped(a, async (tx) => ({
      members: await tx.select().from(companyMembers),
      stages: await tx.select().from(stages),
    }));
    const memberId = catalog.members.find(
      (member) => member.userId === seller.user.id,
    )?.id;
    const stageId = catalog.stages.find(
      (stage) => stage.name === "New Lead",
    )?.id;
    if (!memberId || !stageId) throw new Error("Missing Admin or open stage");
    const ids = Array.from({ length: 205 }, (_, index) => leadId(index + 1));
    await fixture.scoped(a, (tx) =>
      tx.insert(leads).values(
        ids.map((id) => ({
          id,
          companyId: a.companyId,
          phoneValid: false,
          sourceKind: "import" as const,
          leadDate: fixture.now(),
          stageId,
          custom: {},
          score: 0,
          priority: "cold" as const,
          scoreBreakdown: {},
          scoredAt: fixture.now(),
          assignedTo: memberId,
          nextActionAt: new Date(fixture.now().getTime() - 60_000),
        })),
      ),
    );
    const firstPage = await fixture.scoped(a, (tx) =>
      due.listDueFollowUps(tx, { at: fixture.now(), limit: 100 }),
    );
    expect(firstPage.items.map((row) => row.leadId)).toEqual(ids.slice(0, 100));
    expect(firstPage.nextId).toBe(ids[99]);

    const system = await tenant.startSystem(fixture.postgres.appUrl);
    try {
      let crash = true;
      const service = overdue.create({
        now: fixture.now,
        withSystemTenant: system.withSystemTenant,
        readScopedCompanyTimezone: recipients.readScopedCompanyTimezone,
        readScopedCompanySlug: recipients.readScopedCompanySlug,
        openPeriod: periods.openPeriod,
        checkpointPeriod: periods.checkpointPeriod,
        listDueFollowUps: due.listDueFollowUps,
        hasNotification: periods.hasNotification,
        canReceiveCompanyNotification: recipients.canReceiveCompanyNotification,
        async notify(tx, input) {
          if (input.data.type !== "overdue")
            throw new Error("Expected an overdue notice");
          const [saved] = await tx
            .insert(notifications)
            .values({
              id: v7(),
              companyId: input.companyId,
              userId: input.userId,
              type: input.data.type,
              title: input.title,
              body: input.body,
              url: input.url,
              data: input.data,
              dedupeKey: input.dedupeKey,
            })
            .returning({ id: notifications.id });
          if (crash && input.data.leadId === leadId(135)) {
            crash = false;
            throw new Error("Notification store is down");
          }
          if (!saved) throw new Error("Notification was not saved");
          return saved;
        },
      });
      const slot = new Date(
        Math.floor(fixture.now().getTime() / 1_800_000) * 1_800_000,
      ).toISOString();
      const job = { agencyId: a.agencyId, companyId: a.companyId, slot };
      const control = { signal: new AbortController().signal };
      const state = () =>
        fixture.scoped(a, async (tx) => ({
          notices: await tx
            .select()
            .from(notifications)
            .where(eq(notifications.type, "overdue"))
            .orderBy(notifications.dedupeKey),
          period: (
            await tx
              .select()
              .from(companyJobPeriods)
              .where(
                and(
                  eq(companyJobPeriods.jobName, "followups.overdue_scan"),
                  eq(companyJobPeriods.periodKey, slot),
                ),
              )
          )[0],
        }));

      await expect(service.scan(job, control)).rejects.toThrow(
        "Notification store is down",
      );
      const interrupted = await state();
      expect(interrupted.notices).toHaveLength(100);
      expect(interrupted.period).toMatchObject({
        cursor: leadId(100),
        status: "running",
      });

      await service.scan(job, control);
      await service.scan(job, control);
      const complete = await state();
      expect(complete.notices).toHaveLength(205);
      expect(complete.notices.map((row) => row.data.leadId)).toEqual(ids);
      expect(new Set(complete.notices.map((row) => row.dedupeKey)).size).toBe(
        205,
      );
      expect(complete.period).toMatchObject({
        cursor: leadId(205),
        status: "done",
      });
    } finally {
      await system.close();
    }
  });
});
