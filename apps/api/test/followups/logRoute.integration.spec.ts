import {
  companyMembers,
  leadEvents,
  leads,
  lostReasons,
  notifications,
  outcomes,
  stages,
} from "@anar/db/tenant";
import { and, eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import followUps from "../../src/modules/followups/service.js";
import leadFollowUp from "../../src/modules/leads/followUp.js";
import nextLead from "../../src/modules/leads/nextLead.js";
import {
  loadActiveConfig,
  scoreLead,
} from "../../src/modules/scoring/index.js";
import {
  loadHistoricalReferences,
  loadSchema,
  readOutcomeFacts,
} from "../../src/modules/settings/index.js";
import { publicOrigin } from "../auth/fixture.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

type Target = { agencyId: string; companyId: string };

describe("log follow-up route", () => {
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

  const post = (
    slug: string,
    payload: object,
    cookie?: string,
    origin: string | null = publicOrigin,
  ) =>
    fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${slug}/followups/logFollowUp`,
      payload,
      headers: {
        ...(origin ? { origin } : {}),
        ...(cookie ? { cookie } : {}),
      },
    });

  async function setup() {
    const base = await fixture.setup();
    const catalog = await fixture.scoped(base.a, async (tx) => ({
      stages: await tx.select().from(stages),
      outcomes: await tx.select().from(outcomes),
      reasons: await tx.select().from(lostReasons),
      members: await tx.select().from(companyMembers),
    }));
    const stageId = (name: string) => {
      const stage = catalog.stages.find((row) => row.name === name);
      if (!stage) throw new Error(`Missing stage ${name}`);
      return stage.id;
    };
    const outcomeId = (name: string) => {
      const outcome = catalog.outcomes.find((row) => row.name === name);
      if (!outcome) throw new Error(`Missing outcome ${name}`);
      return outcome.id;
    };
    const sellerMember = catalog.members.find(
      (row) => row.userId === base.seller.user.id,
    );
    if (!sellerMember) throw new Error("Missing Admin member");
    const leadId = v7();
    await fixture.addLead(base.a, stageId("New Lead"), { id: leadId });
    return {
      ...base,
      stageId,
      outcomeId,
      reasonId: catalog.reasons[0].id,
      sellerMember,
      leadId,
    };
  }

  const body = (leadId: string, outcomeId: string, change: object = {}) => ({
    requestId: v7(),
    leadId,
    outcomeId,
    ...change,
  });

  async function stored(target: Target, leadId: string) {
    return fixture.scoped(target, async (tx) => {
      const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
      const { rows } = await tx.execute<{
        calls: number;
        events: number;
      }>(sql`SELECT
        (SELECT count(*)::int FROM follow_ups WHERE lead_id = ${leadId}) AS calls,
        (SELECT count(*)::int FROM lead_events WHERE lead_id = ${leadId}) AS events`);
      return { lead, ...rows[0] };
    });
  }

  const lostNotifications = (target: Target) =>
    fixture.scoped(target, (tx) =>
      tx
        .select()
        .from(notifications)
        .where(eq(notifications.type, "lost_suggested"))
        .orderBy(notifications.userId, notifications.id),
    );

  const suggestionEvents = (target: Target, leadId: string) =>
    fixture.scoped(target, (tx) =>
      tx
        .select()
        .from(leadEvents)
        .where(
          and(
            eq(leadEvents.leadId, leadId),
            eq(leadEvents.type, "lost_suggested"),
          ),
        )
        .orderBy(leadEvents.id),
    );

  async function failedCalls(
    slug: string,
    cookie: string,
    leadId: string,
    outcomeId: string,
    count: number,
  ) {
    let result: Record<string, unknown> | null = null;
    for (let index = 0; index < count; index++) {
      const response = await post(slug, body(leadId, outcomeId), cookie);
      expect(response.statusCode).toBe(200);
      result = response.json().data;
    }
    return result;
  }

  it("saves one call and returns the updated lead", async () => {
    const { a, manager, slug, leadId, outcomeId } = await setup();
    const response = await post(
      slug,
      body(leadId, outcomeId("No Answer"), {
        notes: "Call again tomorrow",
        nextActionAt: "2026-11-01T10:00:00+05:45",
      }),
      manager.cookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      lead: { id: leadId, failedAttempts: 1 },
      followUp: {
        leadId,
        byUserId: manager.user.id,
        notes: "Call again tomorrow",
        nextActionAt: "2026-11-01T04:15:00.000Z",
      },
      lostSuggested: false,
      nextLeadId: null,
    });
    const saved = await stored(a, leadId);
    expect(saved).toMatchObject({ calls: 1, events: 1 });
    expect(saved.lead.lastContactedAt).toEqual(fixture.now());
    expect(saved.lead.failedAttempts).toBe(1);
    expect(
      (await fixture.audits("followups.logged")).map((row) => row.target_id),
    ).toContain(leadId);
    const detail = await fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/leads/getLead?leadId=${leadId}`,
      headers: { cookie: manager.cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.followUps).toMatchObject([
      { leadId, notes: "Call again tomorrow" },
    ]);
  });

  it("rolls back the stage, event and audit when custom answers are invalid", async () => {
    const { a, manager, slug, leadId, outcomeId, stageId } = await setup();
    const response = await post(
      slug,
      body(leadId, outcomeId("No Answer"), {
        stageId: stageId("Booked"),
        custom: { unknown_answer: "x" },
      }),
      manager.cookie,
    );
    expect(response.statusCode).toBe(400);
    const saved = await stored(a, leadId);
    expect(saved).toMatchObject({ calls: 0, events: 0 });
    expect(saved.lead).toMatchObject({
      stageId: stageId("New Lead"),
      failedAttempts: 0,
      lastContactedAt: null,
    });
    expect(await fixture.audits("leads.stage_changed")).toEqual([]);
    expect(await fixture.audits("followups.logged")).toEqual([]);
  });

  it("replays one request and refuses the same ID with different notes", async () => {
    const { a, manager, slug, leadId, outcomeId } = await setup();
    const input = body(leadId, outcomeId("No Answer"), {
      notes: "No answer",
    });
    const [first, second] = await Promise.all([
      post(slug, input, manager.cookie),
      post(slug, input, manager.cookie),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toEqual(first.json().data);
    expect(
      (await post(slug, { ...input, notes: "Different note" }, manager.cookie))
        .statusCode,
    ).toBe(409);
    const saved = await stored(a, leadId);
    expect(saved).toMatchObject({ calls: 1, events: 1 });
    expect(saved.lead.failedAttempts).toBe(1);
    expect(await fixture.audits("followups.logged")).toHaveLength(1);
  });

  it("checks an Admin's assignment again on replay", async () => {
    const { a, seller, slug, leadId, outcomeId, sellerMember } = await setup();
    const input = body(leadId, outcomeId("Connected - High Interest"));
    expect((await post(slug, input, seller.cookie)).statusCode).toBe(404);
    await fixture.scoped(a, (tx) =>
      tx
        .update(leads)
        .set({ assignedTo: sellerMember.id })
        .where(eq(leads.id, leadId)),
    );
    expect((await post(slug, input, seller.cookie)).statusCode).toBe(200);
    await fixture.scoped(a, (tx) =>
      tx.update(leads).set({ assignedTo: null }).where(eq(leads.id, leadId)),
    );
    expect((await post(slug, input, seller.cookie)).statusCode).toBe(404);
    expect((await stored(a, leadId)).calls).toBe(1);
  });

  it("stores an entered staff call without a member", async () => {
    const { a, slug, leadId, outcomeId } = await setup();
    const entered = await fixture.companyRequest(
      "POST",
      "enterCompany",
      a.cookie,
      { companyId: a.companyId, reason: "Calling for the client" },
    );
    expect(entered.statusCode).toBe(200);
    const response = await post(
      slug,
      body(leadId, outcomeId("Site Visit Done")),
      a.cookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().data.followUp).toMatchObject({
      byUserId: a.user.id,
      byMemberId: null,
    });
    const { rows } = await fixture.scoped(a, (tx) =>
      tx.execute<{
        by_user_id: string;
        by_member_id: string | null;
        is_site_visit: boolean;
      }>(sql`SELECT by_user_id, by_member_id, is_site_visit
        FROM follow_ups WHERE lead_id = ${leadId}`),
    );
    expect(rows).toEqual([
      { by_user_id: a.user.id, by_member_id: null, is_site_visit: true },
    ]);
  });

  it("keeps the note when a call moves the lead to lost", async () => {
    const { a, manager, slug, leadId, outcomeId, stageId, reasonId } =
      await setup();
    const response = await post(
      slug,
      body(leadId, outcomeId("Not Interested"), {
        notes: "Asked us to stop calling",
        stageId: stageId("Lost"),
        lostReasonId: reasonId,
        nextActionAt: "2026-11-01T10:00:00+05:45",
      }),
      manager.cookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      lead: { stageId: stageId("Lost"), nextActionAt: null },
      followUp: { notes: "Asked us to stop calling", nextActionAt: null },
    });
    expect((await stored(a, leadId)).calls).toBe(1);
  });

  it("refuses another company, no session and a hostile origin", async () => {
    const { a, foreign, slug, leadId, outcomeId } = await setup();
    const input = body(leadId, outcomeId("No Answer"));
    expect((await post(slug, input, foreign.cookie)).statusCode).toBe(404);
    expect((await post(slug, input)).statusCode).toBe(401);
    expect(
      (await post(slug, input, a.cookie, "https://evil.example.test"))
        .statusCode,
    ).toBe(403);
    expect((await stored(a, leadId)).calls).toBe(0);
  });

  it("notifies managers on the fifth failed call only", async () => {
    const { a, manager, slug, leadId, outcomeId } = await setup();
    const other = await fixture.seedUser();
    await fixture.seedMember(a, other.id, "active", "super_admin");
    const failed = outcomeId("No Answer");
    const fourth = await failedCalls(slug, manager.cookie, leadId, failed, 4);
    expect(fourth).toMatchObject({
      lead: { failedAttempts: 4, lostSuggestedAt: null },
      lostSuggested: false,
    });
    expect(await lostNotifications(a)).toEqual([]);

    const fifth = await failedCalls(slug, manager.cookie, leadId, failed, 1);
    expect(fifth).toMatchObject({
      lead: { failedAttempts: 5 },
      lostSuggested: true,
    });
    const [event] = await suggestionEvents(a, leadId);
    expect(event).toMatchObject({
      data: { failedAttempts: 5 },
    });
    const saved = await lostNotifications(a);
    expect(saved).toHaveLength(2);
    expect(saved.map((row) => row.userId).sort()).toEqual(
      [manager.user.id, other.id].sort(),
    );
    for (const row of saved) {
      expect(row).toMatchObject({
        dedupeKey: `lost:${a.companyId}:${leadId}:${event.id}`,
        url: `/${slug}/leads/${leadId}`,
        data: { type: "lost_suggested", leadId, failedAttempts: 5 },
      });
    }

    const sixth = await failedCalls(slug, manager.cookie, leadId, failed, 1);
    expect(sixth).toMatchObject({
      lead: { failedAttempts: 6 },
      lostSuggested: false,
    });
    expect(await suggestionEvents(a, leadId)).toHaveLength(1);
    expect(await lostNotifications(a)).toEqual(saved);
  });

  it("creates one suggestion when two fifth calls race", async () => {
    const { a, manager, slug, leadId, outcomeId } = await setup();
    const failed = outcomeId("No Answer");
    await failedCalls(slug, manager.cookie, leadId, failed, 4);
    const [first, second] = await Promise.all([
      post(slug, body(leadId, failed), manager.cookie),
      post(slug, body(leadId, failed), manager.cookie),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(
      [first, second]
        .map((response) => response.json().data.lostSuggested)
        .sort(),
    ).toEqual([false, true]);
    expect((await stored(a, leadId)).lead.failedAttempts).toBe(6);
    const events = await suggestionEvents(a, leadId);
    expect(events).toHaveLength(1);
    expect(await lostNotifications(a)).toMatchObject([
      {
        userId: manager.user.id,
        dedupeKey: `lost:${a.companyId}:${leadId}:${events[0].id}`,
      },
    ]);
  });

  it("skips a manager removed before the fifth call", async () => {
    const { a, manager, slug, leadId, outcomeId } = await setup();
    const removed = await fixture.seedUser();
    await fixture.seedMember(a, removed.id, "active", "super_admin");
    const failed = outcomeId("No Answer");
    await failedCalls(slug, manager.cookie, leadId, failed, 4);
    await fixture.scoped(a, (tx) =>
      tx
        .update(companyMembers)
        .set({ status: "deactivated", deactivatedAt: fixture.now() })
        .where(eq(companyMembers.userId, removed.id)),
    );
    expect(
      await failedCalls(slug, manager.cookie, leadId, failed, 1),
    ).toMatchObject({
      lostSuggested: true,
    });
    expect((await lostNotifications(a)).map((row) => row.userId)).toEqual([
      manager.user.id,
    ]);
  });

  it("rolls back the fifth call when a notification fails", async () => {
    const { a, manager, slug, leadId, outcomeId } = await setup();
    await fixture.scoped(a, (tx) =>
      tx.update(leads).set({ failedAttempts: 4 }).where(eq(leads.id, leadId)),
    );
    const writer = leadFollowUp.create({
      loadSchema,
      loadHistoricalReferences,
      loadActiveConfig,
      scoreLead,
    });
    const service = followUps.create({
      context: fixture.apps[0].tenant,
      now: fixture.now,
      readVisibleLead: writer.readVisibleLeadForCall,
      readOutcomeFacts,
      readOriginalBucket: nextLead.readOriginalBucket,
      applyFollowUp: writer.applyFollowUp,
      nextLeadId: nextLead.nextLeadId,
      canReceiveCompanyNotification: async () => true,
      notify: async () => {
        throw new Error("Notification store is down");
      },
    });
    const actor = await service.requireContext(
      { headers: { cookie: manager.cookie } },
      slug,
    );
    await expect(
      service.logFollowUp(actor, body(leadId, outcomeId("No Answer")), {
        ip: null,
      }),
    ).rejects.toThrow("Notification store is down");
    const saved = await stored(a, leadId);
    expect(saved).toMatchObject({ calls: 0, events: 0 });
    expect(saved.lead).toMatchObject({
      failedAttempts: 4,
      lostSuggestedAt: null,
      lastContactedAt: null,
    });
    expect(await lostNotifications(a)).toEqual([]);
    expect(await fixture.audits("followups.logged")).toEqual([]);
  });

  it("notifies again after a manager keeps the lead", async () => {
    const { a, manager, slug, leadId, outcomeId } = await setup();
    const failed = outcomeId("No Answer");
    await failedCalls(slug, manager.cookie, leadId, failed, 5);
    const [first] = await suggestionEvents(a, leadId);
    const firstNotification = (await lostNotifications(a))[0];
    const success = await post(
      slug,
      body(leadId, outcomeId("Connected - High Interest")),
      manager.cookie,
    );
    expect(success.statusCode).toBe(200);
    expect(success.json().data).toMatchObject({
      lead: { failedAttempts: 0 },
      lostSuggested: false,
    });
    expect((await stored(a, leadId)).lead.lostSuggestedAt).not.toBeNull();
    const kept = await fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${slug}/leads/dismissLostSuggestion`,
      payload: { leadId, suggestionEventId: first.id },
      headers: { origin: publicOrigin, cookie: manager.cookie },
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json().data.lead).toMatchObject({
      failedAttempts: 0,
      lostSuggestedAt: null,
    });
    expect(
      await failedCalls(slug, manager.cookie, leadId, failed, 5),
    ).toMatchObject({
      lead: { failedAttempts: 5 },
      lostSuggested: true,
    });
    const events = await suggestionEvents(a, leadId);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.id)).toContain(first.id);
    const saved = await lostNotifications(a);
    expect(saved).toHaveLength(2);
    expect(saved).toContainEqual(firstNotification);
    expect(saved.map((row) => row.dedupeKey).sort()).toEqual(
      events.map((event) => `lost:${a.companyId}:${leadId}:${event.id}`).sort(),
    );
  });
});
