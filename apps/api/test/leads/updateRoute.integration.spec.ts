import { leads, stages } from "@anar/db/tenant";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { publicOrigin } from "../auth/fixture.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

const minute = 60 * 1000;

describe("lead edit route", () => {
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
      url: `/api/companies/${slug}/leads/updateLeadFields`,
      payload,
      headers: {
        ...(origin ? { origin } : {}),
        ...(cookie ? { cookie } : {}),
      },
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
    });
    await fixture.addLead(base.a, stage.id, {
      phoneE164: "+9779841000007",
      phoneValid: true,
    });
    return { ...base, leadId };
  }

  it("saves a change and sends the lead back with ISO dates", async () => {
    const { manager, slug, leadId } = await setup();
    const response = await post(
      slug,
      { leadId, phoneRaw: "9841000008" },
      manager.cookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().data.lead).toMatchObject({
      id: leadId,
      phoneE164: "+9779841000008",
      phoneValid: true,
      leadDate: fixture.now().toISOString(),
    });
  });

  it.each([
    ["a hostile origin", "https://evil.example.test"],
    ["no origin", null],
  ])("refuses %s and changes nothing", async (_name, origin) => {
    const { a, manager, slug, leadId } = await setup();
    const response = await post(
      slug,
      { leadId, fullName: "Changed" },
      manager.cookie,
      origin,
    );
    expect(response.statusCode).toBe(403);
    const [lead] = await fixture.scoped(a, (tx) =>
      tx.select().from(leads).where(eq(leads.id, leadId)),
    );
    expect(lead.fullName).toBe("Sita Sharma");
  });

  it("lets entered staff edit until the entry ends", async () => {
    const { a, slug, leadId } = await setup();
    await fixture.companyRequest("POST", "enterCompany", a.cookie, {
      companyId: a.companyId,
      reason: "Fixing a lead for the client",
    });
    expect(
      (await post(slug, { leadId, fullName: "Sita S." }, a.cookie)).statusCode,
    ).toBe(200);
    fixture.advance(8 * 60 * minute);
    expect(
      (await post(slug, { leadId, fullName: "Sita T." }, a.cookie)).statusCode,
    ).toBe(403);
  });

  it.each([
    ["an Admin on someone else's lead", "seller", {}, 404],
    ["a made-up lead", "manager", { leadId: v7() }, 404],
    ["no change at all", "manager", { fullName: undefined }, 400],
    ["an unknown field", "manager", { custom: { nope: "x" } }, 400],
    ["a phone another lead has", "manager", { phoneRaw: "9841000007" }, 409],
  ] as const)("answers %s with %i", async (_name, who, change, status) => {
    const context = await setup();
    const response = await post(
      context.slug,
      { leadId: context.leadId, fullName: "Sita S.", ...change },
      context[who].cookie,
    );
    expect(response.statusCode).toBe(status);
  });

  it("refuses other companies and no session", async () => {
    const { foreign, slug, leadId } = await setup();
    expect(
      (await post(slug, { leadId, fullName: "X" }, foreign.cookie)).statusCode,
    ).toBe(404);
    expect((await post(slug, { leadId, fullName: "X" })).statusCode).toBe(401);
  });
});
