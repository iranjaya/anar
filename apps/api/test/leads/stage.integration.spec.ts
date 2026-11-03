import { leadEvents, leads, lostReasons, stages } from "@anar/db/tenant";
import type { ChangeStageInput } from "@anar/domain/leads";
import { asc, eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import stage from "../../src/modules/leads/stage.js";
import {
  loadHistoricalReferences,
  loadSchema,
} from "../../src/modules/settings/index.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

type Target = { agencyId: string; companyId: string };

describe("changing a lead's stage", () => {
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
    const { byName, reasons } = await fixture.scoped(base.a, async (tx) => ({
      byName: new Map(
        (await tx.select().from(stages)).map((row) => [row.name, row.id]),
      ),
      reasons: await tx
        .select()
        .from(lostReasons)
        .orderBy(asc(lostReasons.position)),
    }));
    const stageId = (name: string) => byName.get(name) as string;
    const leadId = v7();
    await fixture.addLead(base.a, stageId("New Lead"), {
      id: leadId,
      nextActionAt: fixture.now(),
      failedAttempts: 3,
      lostSuggestedAt: fixture.now(),
    });
    return { ...base, manager, seller, stageId, reasons, leadId };
  }
  async function move(
    who: { cookie: string },
    slug: string,
    input: ChangeStageInput,
  ) {
    const service = stage.create({
      context: fixture.apps[0].tenant,
      now: fixture.now,
      loadSchema,
      loadHistoricalReferences,
    });
    const actor = await service.requireContext(
      { headers: { cookie: who.cookie } },
      slug,
    );
    return service.changeStage(actor, input, { ip: "198.51.100.9" });
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
      sql`select target_id, data from audit_log where action = 'leads.stage_changed' order by created_at, id`,
    );

  it("marks a lead lost with a reason, clearing its next action and suggestion", async () => {
    const { a, manager, stageId, reasons, leadId } = await setup();
    const { lead } = await move(manager, a.company.slug, {
      leadId,
      stageId: stageId("Lost"),
      lostReasonId: reasons[0].id,
    });
    expect(lead).toMatchObject({
      stageId: stageId("Lost"),
      lostReasonId: reasons[0].id,
      nextActionAt: null,
      lostSuggestedAt: null,
      failedAttempts: 3,
    });
    expect((await read(a, leadId)).events).toEqual([
      {
        type: "stage_changed",
        data: {
          from: stageId("New Lead"),
          to: stageId("Lost"),
          fromKind: "open",
          toKind: "lost",
          lostReasonId: reasons[0].id,
        },
      },
    ]);
    expect(await audits()).toEqual([
      { target_id: leadId, data: { stageId: stageId("Lost") } },
    ]);
  });

  it("reopens a lost lead with no next action and a fresh attempt count", async () => {
    const { a, manager, stageId, reasons, leadId } = await setup();
    await move(manager, a.company.slug, {
      leadId,
      stageId: stageId("Lost"),
      lostReasonId: reasons[0].id,
    });
    const { lead } = await move(manager, a.company.slug, {
      leadId,
      stageId: stageId("Contacted"),
    });
    expect(lead).toMatchObject({
      lostReasonId: null,
      nextActionAt: null,
      failedAttempts: 0,
    });
  });

  it("records a new reason on the same lost stage, and nothing for no change", async () => {
    const { a, manager, stageId, reasons, leadId } = await setup();
    const lost = { leadId, stageId: stageId("Lost") };
    await move(manager, a.company.slug, {
      ...lost,
      lostReasonId: reasons[0].id,
    });
    await move(manager, a.company.slug, {
      ...lost,
      lostReasonId: reasons[1].id,
    });
    await move(manager, a.company.slug, {
      ...lost,
      lostReasonId: reasons[1].id,
    });
    expect((await read(a, leadId)).events).toHaveLength(2);
    expect(await audits()).toHaveLength(2);
  });

  it.each([
    ["no reason", "Lost", "none"],
    ["an archived reason", "Lost", "archived"],
    ["another company's reason", "Lost", "foreign"],
    ["a reason on an open stage", "Contacted", "first"],
  ] as const)("refuses %s and writes nothing", async (_name, target, pick) => {
    const context = await setup();
    const { a, b, manager, stageId, reasons, leadId } = context;
    let lostReasonId: string | undefined;
    if (pick === "first") lostReasonId = reasons[0].id;
    if (pick === "archived") {
      lostReasonId = reasons[0].id;
      await fixture.scoped(a, (tx) =>
        tx
          .update(lostReasons)
          .set({ archivedAt: fixture.now() })
          .where(eq(lostReasons.id, reasons[0].id)),
      );
    }
    if (pick === "foreign")
      lostReasonId = (
        await fixture.scoped(b, (tx) => tx.select().from(lostReasons))
      )[0].id;
    await expect(
      move(manager, a.company.slug, {
        leadId,
        stageId: stageId(target),
        lostReasonId,
      }),
    ).rejects.toMatchObject({ code: "validation" });
    const after = await read(a, leadId);
    expect(after.lead.stageId).toBe(stageId("New Lead"));
    expect(after.events).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  it("refuses an archived stage as a destination but keeps a lead already on one", async () => {
    const { a, manager, stageId, leadId } = await setup();
    await fixture.scoped(a, (tx) =>
      tx
        .update(stages)
        .set({ archivedAt: fixture.now() })
        .where(eq(stages.id, stageId("Qualified"))),
    );
    await expect(
      move(manager, a.company.slug, { leadId, stageId: stageId("Qualified") }),
    ).rejects.toMatchObject({ code: "validation" });
    await fixture.scoped(a, (tx) =>
      tx
        .update(leads)
        .set({ stageId: stageId("Qualified") })
        .where(eq(leads.id, leadId)),
    );
    const { lead } = await move(manager, a.company.slug, {
      leadId,
      stageId: stageId("Qualified"),
    });
    expect(lead.stageId).toBe(stageId("Qualified"));
    expect((await read(a, leadId)).events).toEqual([]);
  });

  it("lets an Admin move only their own lead", async () => {
    const { a, seller, stageId, leadId } = await setup();
    await expect(
      move(seller, a.company.slug, { leadId, stageId: stageId("Booked") }),
    ).rejects.toMatchObject({ code: "not_found" });
    await fixture.scoped(a, (tx) =>
      tx
        .update(leads)
        .set({ assignedTo: seller.member.id })
        .where(eq(leads.id, leadId)),
    );
    const { lead } = await move(seller, a.company.slug, {
      leadId,
      stageId: stageId("Booked"),
    });
    expect(lead).toMatchObject({ nextActionAt: null, failedAttempts: 3 });
  });

  it("keeps the lead and its history unchanged when the audit write fails", async () => {
    const { a, manager, stageId, leadId } = await setup();
    await fixture.owner("REVOKE INSERT ON audit_log FROM anar_app");
    try {
      await expect(
        move(manager, a.company.slug, { leadId, stageId: stageId("Booked") }),
      ).rejects.toThrow();
    } finally {
      await fixture.owner("GRANT INSERT ON audit_log TO anar_app");
    }
    const after = await read(a, leadId);
    expect(after.lead.stageId).toBe(stageId("New Lead"));
    expect(after.events).toEqual([]);
  });
});
