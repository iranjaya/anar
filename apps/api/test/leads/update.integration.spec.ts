import {
  fields,
  leadEvents,
  leads,
  scoringConfigs,
  stages,
} from "@anar/db/tenant";
import type { UpdateLeadFieldsInput } from "@anar/domain/leads";
import { asc, eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import update from "../../src/modules/leads/update.js";
import {
  loadActiveConfig,
  scoreLead,
} from "../../src/modules/scoring/index.js";
import { loadSchema } from "../../src/modules/settings/index.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

type Target = { agencyId: string; companyId: string };

describe("editing a lead's contact details and answers", () => {
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

  async function setup() {
    const base = await fixture.setup();
    const login = async (role: "super_admin" | "admin") => {
      const user = await fixture.seedUser();
      const member = await fixture.seedMember(base.a, user.id, "active", role);
      const { cookie } = await fixture.loginAs(user);
      return { cookie, member };
    };
    const manager = await login("super_admin");
    const seller = await login("admin");
    const [stage] = await fixture.scoped(base.a, (tx) =>
      tx.select().from(stages).where(eq(stages.isDefault, true)),
    );
    const leadId = v7();
    await fixture.addLead(base.a, stage.id, {
      id: leadId,
      fullName: "Sita Sharma",
      phoneRaw: "98-bad",
      score: 1,
      priority: "cold",
      scoreBreakdown: { base: 1 },
      custom: { old_note: "Keep me" },
    });
    return { ...base, manager, seller, stageId: stage.id, leadId };
  }
  async function edit(
    who: { cookie: string },
    slug: string,
    input: UpdateLeadFieldsInput,
  ) {
    const service = update.create({
      context: fixture.apps[0].tenant,
      now: fixture.now,
      loadSchema,
      loadActiveConfig,
      scoreLead,
    });
    const actor = await service.requireContext(
      { headers: { cookie: who.cookie } },
      slug,
    );
    return service.updateLeadFields(actor, input, { ip: "198.51.100.9" });
  }
  const read = (target: Target, leadId: string) =>
    fixture.scoped(target, async (tx) => {
      const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
      const events = await tx
        .select({ type: leadEvents.type, data: leadEvents.data })
        .from(leadEvents)
        .where(eq(leadEvents.leadId, leadId))
        .orderBy(asc(leadEvents.createdAt), asc(leadEvents.id));
      return { lead, events };
    });
  const audits = () =>
    fixture.rows<{ target_id: string; data: Record<string, string> }>(
      sql`select target_id, data from audit_log where action = 'leads.updated' order by created_at, id`,
    );

  it("repairs a phone without touching the score, and keeps contact values out of history", async () => {
    const { a, manager, leadId } = await setup();
    const { lead } = await edit(manager, a.company.slug, {
      leadId,
      phoneRaw: "9841000005",
    });
    expect(lead).toMatchObject({
      phoneRaw: "9841000005",
      phoneE164: "+9779841000005",
      phoneValid: true,
      score: 1,
      priority: "cold",
    });
    const stored = await read(a, leadId);
    expect(stored.lead.scoreBreakdown).toEqual({ base: 1 });
    expect(stored.events).toEqual([
      { type: "fields_updated", data: { keys: [], systemKeys: ["phoneRaw"] } },
    ]);
    expect(await audits()).toEqual([
      { target_id: leadId, data: { count: "1" } },
    ]);
  });

  it("rescores a changed answer and records the move to a new priority", async () => {
    const { a, manager, leadId } = await setup();
    const { lead } = await edit(manager, a.company.slug, {
      leadId,
      custom: { purchase_timeline: "<15 days" },
    });
    expect(lead).toMatchObject({ score: 5, priority: "warm" });
    expect(lead.scoreBreakdown).toEqual({ base: 1, purchase_timeline: 4 });
    expect(lead.scoredAt).toEqual(fixture.now());
    expect((await read(a, leadId)).events).toEqual([
      {
        type: "fields_updated",
        data: { keys: ["purchase_timeline"], systemKeys: [] },
      },
      { type: "score_changed", data: { from: "cold", to: "warm", score: 5 } },
    ]);
  });

  it("changes points within the same priority without a score event", async () => {
    const { a, manager, leadId } = await setup();
    await edit(manager, a.company.slug, {
      leadId,
      custom: { purchase_timeline: "<15 days" },
    });
    const { lead } = await edit(manager, a.company.slug, {
      leadId,
      custom: { budget_fit: "Maybe" },
    });
    expect(lead).toMatchObject({ score: 7, priority: "warm" });
    const types = (await read(a, leadId)).events.map((event) => event.type);
    expect(types).toEqual([
      "fields_updated",
      "score_changed",
      "fields_updated",
    ]);
  });

  it("writes nothing when every value is already stored", async () => {
    const { a, manager, leadId } = await setup();
    const before = await read(a, leadId);
    const { lead } = await edit(manager, a.company.slug, {
      leadId,
      fullName: "Sita Sharma",
      phoneRaw: "98-bad",
    });
    expect(lead.fullName).toBe("Sita Sharma");
    const after = await read(a, leadId);
    expect(after.lead.updatedAt).toEqual(before.lead.updatedAt);
    expect(after.events).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  it("refuses a phone another live lead has, and saves none of the other edits", async () => {
    const { a, manager, stageId, leadId } = await setup();
    await fixture.addLead(a, stageId, {
      phoneE164: "+9779841000006",
      phoneValid: true,
    });
    await expect(
      edit(manager, a.company.slug, {
        leadId,
        fullName: "Sita S.",
        phoneRaw: "9841000006",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const after = await read(a, leadId);
    expect(after.lead).toMatchObject({
      fullName: "Sita Sharma",
      phoneRaw: "98-bad",
    });
    expect(after.events).toEqual([]);
  });

  it("refuses an answer for a field archived before the save", async () => {
    const { a, manager, leadId } = await setup();
    await fixture.scoped(a, (tx) =>
      tx
        .update(fields)
        .set({ archivedAt: fixture.now() })
        .where(eq(fields.key, "budget_fit")),
    );
    await expect(
      edit(manager, a.company.slug, {
        leadId,
        fullName: "Sita S.",
        custom: { budget_fit: "Yes" },
      }),
    ).rejects.toMatchObject({ code: "validation" });
    expect((await read(a, leadId)).lead.fullName).toBe("Sita Sharma");
  });

  it("rolls back every edit when scoring is not set up", async () => {
    const { a, manager, leadId } = await setup();
    await fixture.scoped(a, (tx) =>
      tx.update(scoringConfigs).set({ active: false }),
    );
    await expect(
      edit(manager, a.company.slug, {
        leadId,
        fullName: "Sita S.",
        custom: { budget_fit: "Yes" },
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    const after = await read(a, leadId);
    expect(after.lead.fullName).toBe("Sita Sharma");
    expect(after.events).toEqual([]);
  });

  it("lets an Admin edit their own lead, and shows it missing once reassigned", async () => {
    const { a, manager, seller, leadId } = await setup();
    await fixture.scoped(a, (tx) =>
      tx
        .update(leads)
        .set({ assignedTo: seller.member.id })
        .where(eq(leads.id, leadId)),
    );
    await edit(seller, a.company.slug, { leadId, email: "sita@example.test" });
    await fixture.scoped(a, (tx) =>
      tx
        .update(leads)
        .set({ assignedTo: manager.member.id })
        .where(eq(leads.id, leadId)),
    );
    await expect(
      edit(seller, a.company.slug, { leadId, fullName: "Sita S." }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await read(a, leadId)).lead).toMatchObject({
      email: "sita@example.test",
      fullName: "Sita Sharma",
    });
  });

  it("leaves an archived answer untouched while another answer changes", async () => {
    const { a, manager, leadId } = await setup();
    const { lead } = await edit(manager, a.company.slug, {
      leadId,
      custom: { decision_maker: "Yes" },
    });
    expect(lead.custom).toEqual({ old_note: "Keep me", decision_maker: "Yes" });
  });
});
