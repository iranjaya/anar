import {
  leadEvents,
  leads,
  lostReasons,
  outcomes,
  stages,
} from "@anar/db/tenant";
import type { ApplyFollowUpInput } from "@anar/domain/leads";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import followUp from "../../src/modules/leads/followUp.js";
import nextLead from "../../src/modules/leads/nextLead.js";
import {
  loadActiveConfig,
  scoreLead,
} from "../../src/modules/scoring/index.js";
import {
  loadHistoricalReferences,
  loadSchema,
} from "../../src/modules/settings/index.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

describe("logging a call updates the lead and picks the next one", () => {
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

  const writer = () =>
    followUp.create({
      loadSchema,
      loadHistoricalReferences,
      loadActiveConfig,
      scoreLead,
    });

  async function setup() {
    const base = await fixture.setup();
    const login = async (role: "super_admin" | "admin") => {
      const user = await fixture.seedUser();
      const member = await fixture.seedMember(base.a, user.id, "active", role);
      const { cookie } = await fixture.loginAs(user);
      const actor = await fixture.apps[0].tenant.requireContext(
        { headers: { cookie } },
        base.slug,
      );
      return { member, actor };
    };
    const manager = await login("super_admin");
    const seller = await login("admin");
    const catalog = await fixture.scoped(base.a, async (tx) => ({
      stages: await tx.select().from(stages),
      reasons: await tx.select().from(lostReasons),
      outcomes: await tx.select().from(outcomes),
    }));
    const stageId = (name: string) => {
      const stage = catalog.stages.find((row) => row.name === name);
      if (!stage) throw new Error(`Missing ${name} stage`);
      return stage.id;
    };
    const reasonId = catalog.reasons[0]?.id;
    const outcomeId = catalog.outcomes[0]?.id;
    if (!reasonId || !outcomeId) throw new Error("Missing call choices");
    const add = async (
      assignedTo: string,
      values: Partial<typeof leads.$inferInsert> = {},
    ) => {
      const id = v7();
      await fixture.addLead(base.a, stageId("New Lead"), {
        id,
        assignedTo,
        ...values,
      });
      return id;
    };
    const save = async (
      who: typeof manager,
      leadId: string,
      changes: Partial<ApplyFollowUpInput> = {},
    ) => {
      const at = fixture.now();
      return fixture.apps[0].tenant.withContext(
        who.actor,
        async (tx, current) => {
          const originalBucket = await nextLead.readOriginalBucket(
            tx,
            current,
            leadId,
            at,
          );
          const { lead, suggestionEventId } = await writer().applyFollowUp(
            tx,
            current,
            {
              leadId,
              followUpId: v7(),
              happenedAt: at,
              outcomeId,
              countsAsFailed: false,
              nextActionAt: null,
              ...changes,
            },
            { ip: null },
          );
          const nextId = await nextLead.nextLeadId(tx, current, {
            originalBucket,
            excludeLeadId: leadId,
            at,
          });
          return { lead, suggestionEventId, originalBucket, nextId };
        },
      );
    };
    const read = (leadId: string) =>
      fixture.scoped(base.a, async (tx) => ({
        lead: (await tx.select().from(leads).where(eq(leads.id, leadId)))[0],
        events: await tx
          .select({ type: leadEvents.type, data: leadEvents.data })
          .from(leadEvents)
          .where(eq(leadEvents.leadId, leadId)),
      }));
    return {
      ...base,
      manager,
      seller,
      stageId,
      reasonId,
      add,
      save,
      read,
    };
  }

  it("suggests Lost once at five failed calls and resets the count after success", async () => {
    const { seller, add, save, read } = await setup();
    const leadId = await add(seller.member.id, { failedAttempts: 4 });
    const fifth = await save(seller, leadId, { countsAsFailed: true });
    expect(fifth.lead.failedAttempts).toBe(5);
    expect(fifth.lead.lostSuggestedAt).toEqual(fixture.now());
    await save(seller, leadId, { countsAsFailed: true });
    const sixth = await read(leadId);
    expect(sixth.lead.failedAttempts).toBe(6);
    expect(
      sixth.events.filter((event) => event.type === "lost_suggested"),
    ).toHaveLength(1);
    expect(
      sixth.events.find((event) => event.type === "lost_suggested")?.data,
    ).toMatchObject({
      failedAttempts: 5,
    });
    const success = await save(seller, leadId);
    expect(success.lead.failedAttempts).toBe(0);
    expect(success.lead.lostSuggestedAt).toEqual(fixture.now());
    expect(
      (await read(leadId)).events.filter(
        (event) => event.type === "lost_suggested",
      ),
    ).toHaveLength(1);
  });

  it("saves the stage, next call and changed answer with its new score", async () => {
    const { seller, stageId, add, save, read } = await setup();
    const leadId = await add(seller.member.id, {
      score: 1,
      priority: "cold",
      scoreBreakdown: { base: 1 },
    });
    const nextActionAt = new Date(fixture.now().getTime() + 86_400_000);
    const { lead } = await save(seller, leadId, {
      stageId: stageId("Contacted"),
      nextActionAt,
      custom: { purchase_timeline: "<15 days" },
    });
    expect(lead).toMatchObject({
      stageId: stageId("Contacted"),
      nextActionAt,
      lastContactedAt: fixture.now(),
      score: 5,
      priority: "warm",
      custom: { purchase_timeline: "<15 days" },
    });
    const stored = await read(leadId);
    expect(stored.lead.scoreBreakdown).toEqual({
      base: 1,
      purchase_timeline: 4,
    });
    expect(stored.events.map((event) => event.type).sort()).toEqual([
      "fields_updated",
      "follow_up_logged",
      "score_changed",
      "stage_changed",
    ]);
  });

  it("clears the next call when a call moves the lead to Lost", async () => {
    const { seller, stageId, reasonId, add, save } = await setup();
    const leadId = await add(seller.member.id);
    const nextActionAt = new Date(fixture.now().getTime() + 86_400_000);
    const { lead } = await save(seller, leadId, {
      stageId: stageId("Lost"),
      lostReasonId: reasonId,
      nextActionAt,
      countsAsFailed: true,
    });
    expect(lead).toMatchObject({
      stageId: stageId("Lost"),
      lostReasonId: reasonId,
      nextActionAt: null,
      failedAttempts: 1,
    });
  });

  it("picks the first remaining lead in the original bucket order", async () => {
    const { manager, seller, add, save } = await setup();
    const now = fixture.now();
    const early = new Date(now.getTime() - 2 * 3_600_000);
    const late = new Date(now.getTime() - 3_600_000);
    const logged = await add(seller.member.id, {
      nextActionAt: new Date(now.getTime() - 3 * 3_600_000),
    });
    await add(manager.member.id, {
      nextActionAt: new Date(now.getTime() - 4 * 3_600_000),
      priority: "hot",
    });
    await add(seller.member.id, { nextActionAt: early, priority: "warm" });
    const first = await add(seller.member.id, {
      nextActionAt: early,
      priority: "hot",
    });
    await add(seller.member.id, { nextActionAt: late, priority: "hot" });
    const result = await save(seller, logged, {
      nextActionAt: new Date(now.getTime() + 86_400_000),
    });
    expect(result.originalBucket).toBe("overdue");
    expect(result.nextId).toBe(first);
  });

  it("does not switch buckets after the logged lead leaves its original one", async () => {
    const { seller, add, save } = await setup();
    const now = fixture.now();
    const logged = await add(seller.member.id, {
      nextActionAt: now,
    });
    await add(seller.member.id, {
      nextActionAt: new Date(now.getTime() - 3_600_000),
    });
    const result = await save(seller, logged, { nextActionAt: null });
    expect(result.originalBucket).toBe("due_today");
    expect(result.nextId).toBeNull();
  });

  it("does not return another member's lead even when the caller can view it", async () => {
    const { manager, seller, add, save } = await setup();
    const now = fixture.now();
    const logged = await add(manager.member.id, {
      nextActionAt: new Date(now.getTime() - 3_600_000),
    });
    await add(seller.member.id, {
      nextActionAt: new Date(now.getTime() - 2 * 3_600_000),
    });
    const result = await save(manager, logged, { nextActionAt: null });
    expect(result.originalBucket).toBe("overdue");
    expect(result.nextId).toBeNull();
  });
});
