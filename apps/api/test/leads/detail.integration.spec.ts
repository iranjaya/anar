import {
  fields,
  leadEvents,
  lostReasons,
  scoringConfigs,
  stages,
} from "@anar/db/tenant";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import profiles from "../../src/modules/auth/profiles.js";
import detail from "../../src/modules/leads/detail.js";
import { loadActiveConfig } from "../../src/modules/scoring/index.js";
import { loadHistoricalReferences } from "../../src/modules/settings/index.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

type Target = { agencyId: string; companyId: string };
const at = (minute: number) => new Date(Date.UTC(2026, 9, 31, 6, minute));

describe("lead detail and its history", () => {
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

  const service = () =>
    detail.create({
      context: fixture.apps[0].tenant,
      loadHistoricalReferences,
      loadActiveConfig,
      readProfiles: profiles.read,
    });

  async function setup() {
    const base = await fixture.setup();
    const login = async (role: "super_admin" | "admin") => {
      const user = await fixture.seedUser();
      const member = await fixture.seedMember(base.a, user.id, "active", role);
      const { cookie } = await fixture.loginAs(user);
      return { cookie, user, member };
    };
    const manager = await login("super_admin");
    const seller = await login("admin");
    const other = await login("admin");
    const [stage] = await fixture.scoped(base.a, (tx) =>
      tx.select().from(stages).where(eq(stages.isDefault, true)),
    );
    return { ...base, manager, seller, other, stageId: stage.id };
  }
  async function addLead(target: Target, stageId: string, row = {}) {
    const id = v7();
    await fixture.addLead(target, stageId, { id, ...row });
    return id;
  }
  const addEvents = (
    target: Target,
    leadId: string,
    actor: { user: { id: string }; member: { id: string } },
    times: Date[],
  ) =>
    fixture.scoped(target, (tx) =>
      tx.insert(leadEvents).values(
        times.map((createdAt, rowNo) => ({
          id: v7(),
          companyId: target.companyId,
          leadId,
          type: "imported" as const,
          actorUserId: actor.user.id,
          actorMemberId: actor.member.id,
          data: { batchId: v7(), rowNo },
          createdAt,
        })),
      ),
    );
  async function as(who: { cookie: string }, slug: string) {
    const leadsDetail = service();
    const actor = await leadsDetail.requireContext(
      { headers: { cookie: who.cookie } },
      slug,
    );
    return {
      get: (leadId: string) => leadsDetail.getLead(actor, { leadId }),
      events: (leadId: string, cursor?: string) =>
        leadsDetail.listLeadEvents(actor, { leadId, cursor }),
    };
  }

  it("shows the stored score, filled answers only, and who acted", async () => {
    const { a, manager, stageId } = await setup();
    await fixture.scoped(a, (tx) =>
      tx.insert(fields).values({
        id: v7(),
        companyId: a.companyId,
        key: "unit_type",
        label: "Unit",
        type: "dropdown",
        options: [{ value: "2bhk", label: "2 BHK" }],
        isSystem: false,
        position: 90,
      }),
    );
    const leadId = await addLead(a, stageId, {
      custom: { unit_type: "2bhk", budget: null },
      score: 42,
      scoreBreakdown: { base: 10, unit_type: 32 },
    });
    await addEvents(a, leadId, manager, [at(1)]);
    const lead = await (await as(manager, a.company.slug)).get(leadId);
    expect(lead.lead.score).toBe(42);
    expect(lead.lead.scoreBreakdown).toEqual({ base: 10, unit_type: 32 });
    expect(lead.hotMin).toBeGreaterThan(0);
    expect(lead.fields).toEqual([
      { key: "unit_type", label: "Unit", value: "2 BHK" },
    ]);
    expect(lead.history.actors).toEqual([
      {
        userId: manager.user.id,
        memberId: manager.member.id,
        name: manager.user.name,
      },
    ]);
    expect(lead.followUps).toEqual([]);
    expect(lead.duplicates).toEqual([]);
  });

  it("still shows a lead on an archived stage, field and lost reason", async () => {
    const { a, manager } = await setup();
    const archivedAt = fixture.now();
    const stageId = v7();
    const reasonId = v7();
    await fixture.scoped(a, async (tx) => {
      await tx.insert(stages).values({
        id: stageId,
        companyId: a.companyId,
        name: "Old stage",
        position: 80,
        kind: "lost",
        isDefault: false,
        archivedAt,
      });
      await tx.insert(lostReasons).values({
        id: reasonId,
        companyId: a.companyId,
        name: "Old reason",
        position: 80,
        archivedAt,
      });
      await tx.insert(fields).values({
        id: v7(),
        companyId: a.companyId,
        key: "old_note",
        label: "Old note",
        type: "text",
        options: null,
        isSystem: false,
        position: 80,
        archivedAt,
      });
    });
    const leadId = await addLead(a, stageId, {
      lostReasonId: reasonId,
      custom: { old_note: "Wants a corner unit" },
    });
    const lead = await (await as(manager, a.company.slug)).get(leadId);
    expect(lead.history.stages.map((stage) => stage.name)).toEqual([
      "Old stage",
    ]);
    expect(lead.history.lostReasons.map((reason) => reason.name)).toEqual([
      "Old reason",
    ]);
    expect(lead.fields).toEqual([
      { key: "old_note", label: "Old note", value: "Wants a corner unit" },
    ]);
  });

  it("pages 51 events as 50 then 1, newest first, through equal times", async () => {
    const { a, manager, stageId } = await setup();
    const leadId = await addLead(a, stageId);
    await addEvents(
      a,
      leadId,
      manager,
      Array.from({ length: 51 }, (_, n) => at(n < 30 ? 5 : n)),
    );
    const reader = await as(manager, a.company.slug);
    const first = await reader.get(leadId);
    expect(first.events).toHaveLength(50);
    const second = await reader.events(leadId, first.nextEventCursor ?? "");
    expect(second.events).toHaveLength(1);
    expect(second.nextCursor).toBe(null);
    const all = [...first.events, ...second.events];
    expect(new Set(all.map((event) => event.id)).size).toBe(51);
    const sorted = [...all].sort(
      (x, y) =>
        y.createdAt.getTime() - x.createdAt.getTime() || (x.id < y.id ? 1 : -1),
    );
    expect(all.map((event) => event.id)).toEqual(
      sorted.map((event) => event.id),
    );
  });

  it("refuses a history cursor made for another lead", async () => {
    const { a, manager, stageId } = await setup();
    const [one, two] = [await addLead(a, stageId), await addLead(a, stageId)];
    await addEvents(
      a,
      one,
      manager,
      Array.from({ length: 51 }, (_, n) => at(n)),
    );
    const reader = await as(manager, a.company.slug);
    const first = await reader.get(one);
    await expect(
      reader.events(two, first.nextEventCursor ?? ""),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("lets an Admin read only their own lead, and its history pages", async () => {
    const { a, seller, other, manager, stageId } = await setup();
    const mine = await addLead(a, stageId, { assignedTo: seller.member.id });
    const theirs = await addLead(a, stageId, { assignedTo: other.member.id });
    const open = await addLead(a, stageId);
    await addEvents(a, theirs, manager, [at(1)]);
    const reader = await as(seller, a.company.slug);
    expect((await reader.get(mine)).lead.id).toBe(mine);
    for (const leadId of [theirs, open, v7()]) {
      await expect(reader.get(leadId)).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(reader.events(leadId)).rejects.toMatchObject({
        code: "not_found",
      });
    }
  });

  it("hides deleted and merged leads, and other companies' leads", async () => {
    const { a, b, manager, stageId } = await setup();
    const target = await addLead(a, stageId);
    const deleted = await addLead(a, stageId, { deletedAt: fixture.now() });
    const merged = await addLead(a, stageId, { mergedIntoId: target });
    const [foreignStage] = await fixture.scoped(b, (tx) =>
      tx.select().from(stages).where(eq(stages.isDefault, true)),
    );
    const foreign = await addLead(b, foreignStage.id);
    const reader = await as(manager, a.company.slug);
    for (const leadId of [deleted, merged, foreign])
      await expect(reader.get(leadId)).rejects.toMatchObject({
        code: "not_found",
      });
  });

  it("is unavailable without an active scoring setup", async () => {
    const { a, manager, stageId } = await setup();
    const leadId = await addLead(a, stageId);
    await fixture.scoped(a, (tx) =>
      tx.update(scoringConfigs).set({ active: false }),
    );
    await expect(
      (await as(manager, a.company.slug)).get(leadId),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("shows a missing lead for a made-up id", async () => {
    const { a, manager } = await setup();
    await expect(
      (await as(manager, a.company.slug)).get("not-a-uuid"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
