import {
  companyMembers,
  leadEvents,
  leads,
  lostReasons,
  outcomes,
  stages,
} from "@anar/db/tenant";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import followUp from "../../src/modules/leads/followUp.js";
import {
  loadActiveConfig,
  scoreLead,
} from "../../src/modules/scoring/index.js";
import {
  loadHistoricalReferences,
  loadSchema,
} from "../../src/modules/settings/index.js";
import { publicOrigin } from "../auth/fixture.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

describe("lost suggestions", () => {
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
    action: string,
    cookie: string,
    payload: object,
  ) =>
    fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${slug}/leads/${action}`,
      payload,
      headers: { origin: publicOrigin, cookie },
    });

  async function setup() {
    const base = await fixture.setup();
    const catalog = await fixture.scoped(base.a, async (tx) => ({
      stages: await tx.select().from(stages),
      reasons: await tx.select().from(lostReasons),
      outcomes: await tx.select().from(outcomes),
      members: await tx.select().from(companyMembers),
    }));
    const stageId = (name: string) => {
      const row = catalog.stages.find((stage) => stage.name === name);
      if (!row) throw new Error(`Missing ${name} stage`);
      return row.id;
    };
    const outcomeId = catalog.outcomes.find(
      (outcome) => outcome.name === "No Answer",
    )?.id;
    const reasonId = catalog.reasons[0]?.id;
    const sellerId = catalog.members.find(
      (member) => member.userId === base.seller.user.id,
    )?.id;
    if (!outcomeId || !reasonId || !sellerId)
      throw new Error("Missing call choices or seller");
    const leadId = v7();
    await fixture.addLead(base.a, stageId("New Lead"), {
      id: leadId,
      assignedTo: sellerId,
    });
    const actor = await fixture.apps[0].tenant.requireContext(
      { headers: { cookie: base.manager.cookie } },
      base.slug,
    );
    const writer = followUp.create({
      loadSchema,
      loadHistoricalReferences,
      loadActiveConfig,
      scoreLead,
    });
    const call = (countsAsFailed = true) =>
      fixture.apps[0].tenant.withContext(actor, (tx, current) =>
        writer.applyFollowUp(
          tx,
          current,
          {
            leadId,
            followUpId: v7(),
            happenedAt: fixture.now(),
            outcomeId,
            countsAsFailed,
            nextActionAt: null,
          },
          { ip: null },
        ),
      );
    const fiveFailed = async () => {
      for (let attempt = 1; attempt < 5; attempt++) await call();
      const fifth = await call();
      if (!fifth.suggestionEventId)
        throw new Error("Fifth call did not suggest Lost");
      return fifth.suggestionEventId;
    };
    const read = () =>
      fixture.scoped(base.a, async (tx) => ({
        lead: (await tx.select().from(leads).where(eq(leads.id, leadId)))[0],
        events: await tx
          .select({
            id: leadEvents.id,
            type: leadEvents.type,
            data: leadEvents.data,
          })
          .from(leadEvents)
          .where(eq(leadEvents.leadId, leadId)),
      }));
    return { ...base, leadId, stageId, reasonId, call, fiveFailed, read };
  }

  it("suggests Lost on the fifth failed call and keeps the same suggestion after more calls", async () => {
    const { slug, manager, leadId, call, read } = await setup();
    for (let attempt = 1; attempt < 5; attempt++) {
      const result = await call();
      expect(result.suggestionEventId).toBeNull();
    }
    expect((await read()).lead.lostSuggestedAt).toBeNull();
    const fifth = await call();
    expect(fifth.lead.failedAttempts).toBe(5);
    expect(fifth.suggestionEventId).toEqual(expect.any(String));
    const detail = await fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/leads/getLead?leadId=${leadId}`,
      headers: { cookie: manager.cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.suggestionEventId).toBe(fifth.suggestionEventId);
    const sixth = await call();
    expect(sixth.lead.failedAttempts).toBe(6);
    expect(sixth.suggestionEventId).toBeNull();
    const success = await call(false);
    expect(success.lead.failedAttempts).toBe(0);
    expect(success.lead.lostSuggestedAt).toEqual(fixture.now());
    const saved = await read();
    expect(
      saved.events.filter((event) => event.type === "lost_suggested"),
    ).toEqual([
      expect.objectContaining({
        id: fifth.suggestionEventId,
        data: expect.objectContaining({ failedAttempts: 5 }),
      }),
    ]);
  });

  it("dismisses the current suggestion and starts a new cycle", async () => {
    const { slug, manager, leadId, fiveFailed, read } = await setup();
    const firstId = await fiveFailed();
    const keep = await post(slug, "dismissLostSuggestion", manager.cookie, {
      leadId,
      suggestionEventId: firstId,
    });
    expect(keep.statusCode).toBe(200);
    expect(keep.json().data.lead).toMatchObject({
      failedAttempts: 0,
      lostSuggestedAt: null,
    });
    expect((await read()).events).toContainEqual(
      expect.objectContaining({
        type: "lost_suggestion_dismissed",
        data: { suggestionEventId: firstId },
      }),
    );
    expect(await fixture.audits("leads.suggestion_dismissed")).toEqual([
      { target_id: leadId },
    ]);
    const secondId = await fiveFailed();
    expect(secondId).not.toBe(firstId);
    expect(
      (
        await post(slug, "dismissLostSuggestion", manager.cookie, {
          leadId,
          suggestionEventId: firstId,
        })
      ).statusCode,
    ).toBe(409);
    expect((await read()).lead.lostSuggestedAt).toEqual(fixture.now());
  });

  it("checks the current suggestion before marking the lead Lost", async () => {
    const { slug, manager, leadId, stageId, reasonId, fiveFailed, read } =
      await setup();
    const oldId = await fiveFailed();
    expect(
      (
        await post(slug, "dismissLostSuggestion", manager.cookie, {
          leadId,
          suggestionEventId: oldId,
        })
      ).statusCode,
    ).toBe(200);
    const currentId = await fiveFailed();
    const move = (suggestionEventId: string) =>
      post(slug, "changeStage", manager.cookie, {
        leadId,
        stageId: stageId("Lost"),
        lostReasonId: reasonId,
        suggestionEventId,
      });
    expect((await move(oldId)).statusCode).toBe(409);
    expect((await read()).lead.stageId).toBe(stageId("New Lead"));
    expect((await move(currentId)).statusCode).toBe(200);
    expect((await read()).lead).toMatchObject({
      stageId: stageId("Lost"),
      lostReasonId: reasonId,
      lostSuggestedAt: null,
    });
  });

  it("lets a manager dismiss a suggestion but refuses an Admin", async () => {
    const { slug, manager, seller, leadId, fiveFailed } = await setup();
    const suggestionEventId = await fiveFailed();
    const input = { leadId, suggestionEventId };
    expect(
      (await post(slug, "dismissLostSuggestion", seller.cookie, input))
        .statusCode,
    ).toBe(403);
    expect(
      (await post(slug, "dismissLostSuggestion", manager.cookie, input))
        .statusCode,
    ).toBe(200);
  });

  it("keeps the suggestion when the dismissal audit write fails", async () => {
    const { slug, manager, leadId, fiveFailed, read } = await setup();
    const suggestionEventId = await fiveFailed();
    await fixture.owner("REVOKE INSERT ON audit_log FROM anar_app");
    try {
      const response = await post(
        slug,
        "dismissLostSuggestion",
        manager.cookie,
        { leadId, suggestionEventId },
      );
      expect(response.statusCode).not.toBe(200);
    } finally {
      await fixture.owner("GRANT INSERT ON audit_log TO anar_app");
    }
    const saved = await read();
    expect(saved.lead).toMatchObject({
      failedAttempts: 5,
      lostSuggestedAt: fixture.now(),
    });
    expect(
      saved.events.filter(
        (event) => event.type === "lost_suggestion_dismissed",
      ),
    ).toEqual([]);
    expect(await fixture.audits("leads.suggestion_dismissed")).toEqual([]);
    expect(
      (
        await post(slug, "dismissLostSuggestion", manager.cookie, {
          leadId,
          suggestionEventId,
        })
      ).statusCode,
    ).toBe(200);
  });
});
