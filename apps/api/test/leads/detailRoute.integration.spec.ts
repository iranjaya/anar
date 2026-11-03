import { followUps, leadEvents, outcomes, stages } from "@anar/db/tenant";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

const minute = 60 * 1000;

describe("lead detail routes", () => {
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

  const get = (slug: string, path: string, cookie?: string) =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/leads/${path}`,
      headers: cookie ? { cookie } : {},
    });
  const enter = (who: { cookie: string; companyId: string }) =>
    fixture.companyRequest("POST", "enterCompany", who.cookie, {
      companyId: who.companyId,
      reason: "Checking a lead for the client",
    });
  async function setup() {
    const base = await fixture.setup();
    const [stage] = await fixture.scoped(base.a, (tx) =>
      tx.select().from(stages).where(eq(stages.isDefault, true)),
    );
    const leadId = v7();
    await fixture.addLead(base.a, stage.id, {
      id: leadId,
      fullName: "Sita Sharma",
      leadDate: new Date("2026-10-31T08:15:30.123Z"),
    });
    await fixture.scoped(base.a, (tx) =>
      tx.insert(leadEvents).values(
        Array.from({ length: 51 }, (_, rowNo) => ({
          id: v7(),
          companyId: base.a.companyId,
          leadId,
          type: "imported" as const,
          actorUserId: base.manager.user.id,
          actorMemberId: null,
          data: { batchId: v7(), rowNo },
        })),
      ),
    );
    return { ...base, leadId };
  }

  it("sends the lead, its first 50 events and the next page with ISO dates", async () => {
    const { manager, slug, leadId } = await setup();
    const first = await get(slug, `getLead?leadId=${leadId}`, manager.cookie);
    expect(first.statusCode).toBe(200);
    const { data } = first.json();
    expect(data.lead).toMatchObject({
      id: leadId,
      fullName: "Sita Sharma",
      leadDate: "2026-10-31T08:15:30.123Z",
    });
    expect(data.events).toHaveLength(50);
    expect(data.history.actors).toHaveLength(1);
    const cursor = encodeURIComponent(data.nextEventCursor);
    const second = await get(
      slug,
      `listLeadEvents?leadId=${leadId}&cursor=${cursor}`,
      manager.cookie,
    );
    expect(second.statusCode).toBe(200);
    expect(second.json().data.events).toHaveLength(1);
    expect(second.json().data.nextCursor).toBe(null);
  });

  it("sends saved calls on both history pages with ISO dates", async () => {
    const { a, manager, slug, leadId } = await setup();
    const [stage] = await fixture.scoped(a, (tx) =>
      tx.select().from(stages).where(eq(stages.isDefault, true)),
    );
    const [outcome] = await fixture.scoped(a, (tx) =>
      tx.select().from(outcomes),
    );
    if (!stage || !outcome) throw new Error("Expected call choices");
    const recentAt = new Date(Date.now() + 86_400_000);
    const oldAt = new Date(Date.now() - 86_400_000);
    const nextActionAt = new Date("2026-11-03T04:15:00.000Z");
    const recentId = v7();
    const oldId = v7();
    await fixture.scoped(a, async (tx) => {
      for (const [id, happenedAt] of [
        [recentId, recentAt],
        [oldId, oldAt],
      ] as const) {
        await tx.insert(followUps).values({
          id,
          companyId: a.companyId,
          leadId,
          byUserId: manager.user.id,
          byMemberId: null,
          outcomeId: outcome.id,
          notes: "Asked to call again",
          happenedAt,
          nextActionAt,
          stageBeforeId: stage.id,
          stageAfterId: stage.id,
          countsAsFailed: false,
          isSiteVisit: false,
          requestId: v7(),
          requestHash: "saved call",
          response: {},
        });
        await tx.insert(leadEvents).values({
          id: v7(),
          companyId: a.companyId,
          leadId,
          type: "follow_up_logged",
          actorUserId: manager.user.id,
          actorMemberId: null,
          data: { followUpId: id, outcomeId: outcome.id },
          createdAt: happenedAt,
        });
      }
    });
    const first = await get(slug, `getLead?leadId=${leadId}`, manager.cookie);
    expect(first.statusCode).toBe(200);
    expect(first.json().data.followUps).toEqual([
      expect.objectContaining({
        id: recentId,
        notes: "Asked to call again",
        happenedAt: recentAt.toISOString(),
        nextActionAt: nextActionAt.toISOString(),
      }),
    ]);
    const cursor = encodeURIComponent(first.json().data.nextEventCursor);
    const second = await get(
      slug,
      `listLeadEvents?leadId=${leadId}&cursor=${cursor}`,
      manager.cookie,
    );
    expect(second.statusCode).toBe(200);
    expect(second.json().data.followUps).toEqual([
      expect.objectContaining({
        id: oldId,
        happenedAt: oldAt.toISOString(),
        nextActionAt: nextActionAt.toISOString(),
      }),
    ]);
  });

  it("lets entered staff read until the entry ends", async () => {
    const { a, slug, leadId } = await setup();
    const path = `getLead?leadId=${leadId}`;
    expect((await get(slug, path, a.cookie)).statusCode).toBe(403);
    expect((await enter(a)).statusCode).toBe(200);
    expect((await get(slug, path, a.cookie)).statusCode).toBe(200);
    fixture.advance(8 * 60 * minute);
    expect((await get(slug, path, a.cookie)).statusCode).toBe(403);
  });

  it("shows an Admin someone else's lead as missing", async () => {
    const { seller, slug, leadId } = await setup();
    for (const path of [
      `getLead?leadId=${leadId}`,
      `listLeadEvents?leadId=${leadId}`,
    ])
      expect((await get(slug, path, seller.cookie)).statusCode).toBe(404);
  });

  it("refuses the owner, other companies and no session", async () => {
    const { owner, foreign, manager, slug, foreignSlug, leadId } =
      await setup();
    const path = `getLead?leadId=${leadId}`;
    expect((await get(slug, path, owner.cookie)).statusCode).toBe(403);
    expect((await get(slug, path, foreign.cookie)).statusCode).toBe(404);
    expect((await get(foreignSlug, path, manager.cookie)).statusCode).toBe(404);
    expect((await get(slug, path)).statusCode).toBe(401);
  });

  it.each([
    ["a made-up lead id", "getLead?leadId=nope", 404],
    ["no lead id", "getLead", 404],
    ["a made-up cursor", "listLeadEvents?leadId=LEAD&cursor=nope", 400],
    ["an unknown key", "listLeadEvents?leadId=LEAD&extra=1", 400],
  ])("answers %s with %i", async (_name, path, status) => {
    const { manager, slug, leadId } = await setup();
    expect(
      (await get(slug, path.replace("LEAD", leadId), manager.cookie))
        .statusCode,
    ).toBe(status);
  });
});
