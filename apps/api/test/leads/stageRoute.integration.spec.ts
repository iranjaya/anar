import { leads, lostReasons, stages } from "@anar/db/tenant";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { publicOrigin } from "../auth/fixture.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

const minute = 60 * 1000;

describe("stage change route", () => {
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
      url: `/api/companies/${slug}/leads/changeStage`,
      payload,
      headers: {
        ...(origin ? { origin } : {}),
        ...(cookie ? { cookie } : {}),
      },
    });
  async function setup() {
    const base = await fixture.setup();
    const { rows, reasons } = await fixture.scoped(base.a, async (tx) => ({
      rows: await tx.select().from(stages),
      reasons: await tx.select().from(lostReasons),
    }));
    const stageId = (name: string) =>
      rows.find((row) => row.name === name)?.id as string;
    const leadId = v7();
    await fixture.addLead(base.a, stageId("New Lead"), { id: leadId });
    return { ...base, stageId, reasonId: reasons[0].id, leadId };
  }
  const stored = async (
    target: { agencyId: string; companyId: string },
    leadId: string,
  ) =>
    (
      await fixture.scoped(target, (tx) =>
        tx.select().from(leads).where(eq(leads.id, leadId)),
      )
    )[0];

  it("moves the lead and sends it back with ISO dates", async () => {
    const { manager, slug, stageId, reasonId, leadId } = await setup();
    const response = await post(
      slug,
      { leadId, stageId: stageId("Lost"), lostReasonId: reasonId },
      manager.cookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().data.lead).toMatchObject({
      id: leadId,
      stageId: stageId("Lost"),
      lostReasonId: reasonId,
      nextActionAt: null,
      leadDate: fixture.now().toISOString(),
    });
  });

  it.each([
    ["a hostile origin", "https://evil.example.test"],
    ["no origin", null],
  ])("refuses %s and changes nothing", async (_name, origin) => {
    const { a, manager, slug, stageId, leadId } = await setup();
    const response = await post(
      slug,
      { leadId, stageId: stageId("Booked") },
      manager.cookie,
      origin,
    );
    expect(response.statusCode).toBe(403);
    expect((await stored(a, leadId)).stageId).toBe(stageId("New Lead"));
  });

  it("lets entered staff move a lead until the entry ends", async () => {
    const { a, slug, stageId, leadId } = await setup();
    await fixture.companyRequest("POST", "enterCompany", a.cookie, {
      companyId: a.companyId,
      reason: "Updating a lead for the client",
    });
    expect(
      (await post(slug, { leadId, stageId: stageId("Contacted") }, a.cookie))
        .statusCode,
    ).toBe(200);
    fixture.advance(8 * 60 * minute);
    expect(
      (await post(slug, { leadId, stageId: stageId("Qualified") }, a.cookie))
        .statusCode,
    ).toBe(403);
  });

  it.each([
    ["an Admin on someone else's lead", "seller", "Booked", {}, 404],
    ["a made-up lead", "manager", "Booked", { leadId: v7() }, 404],
    ["lost with no reason", "manager", "Lost", {}, 400],
    ["a made-up stage", "manager", "Booked", { stageId: v7() }, 400],
    ["an extra key", "manager", "Booked", { note: "x" }, 400],
  ] as const)(
    "answers %s with %i",
    async (_name, who, name, change, status) => {
      const context = await setup();
      const response = await post(
        context.slug,
        { leadId: context.leadId, stageId: context.stageId(name), ...change },
        context[who].cookie,
      );
      expect(response.statusCode).toBe(status);
    },
  );

  it("refuses other companies and no session", async () => {
    const { foreign, slug, stageId, leadId } = await setup();
    const body = { leadId, stageId: stageId("Booked") };
    expect((await post(slug, body, foreign.cookie)).statusCode).toBe(404);
    expect((await post(slug, body)).statusCode).toBe(401);
  });
});
