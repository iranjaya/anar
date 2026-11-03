import { leads, notifications, stages } from "@anar/db/tenant";
import { eq, inArray } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { publicOrigin } from "../auth/fixture.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

const minute = 60 * 1000;

describe("assignment route", () => {
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
      url: `/api/companies/${slug}/leads/assignLeads`,
      payload,
      headers: {
        ...(origin ? { origin } : {}),
        ...(cookie ? { cookie } : {}),
      },
    });
  async function setup() {
    const base = await fixture.setup();
    const user = await fixture.seedUser();
    const target = await fixture.seedMember(base.a, user.id, "active", "admin");
    const [stage] = await fixture.scoped(base.a, (tx) =>
      tx.select().from(stages).where(eq(stages.isDefault, true)),
    );
    const leadIds = [v7(), v7()];
    for (const id of leadIds) await fixture.addLead(base.a, stage.id, { id });
    return { ...base, user, target, leadIds };
  }
  const owners = (
    target: { agencyId: string; companyId: string },
    ids: string[],
  ) =>
    fixture.scoped(target, async (tx) =>
      (
        await tx
          .select({ assignedTo: leads.assignedTo })
          .from(leads)
          .where(inArray(leads.id, ids))
      ).map((row) => row.assignedTo),
    );

  it("assigns and leaves one notification for the new owner", async () => {
    const { a, manager, user, target, leadIds, slug } = await setup();
    const response = await post(
      slug,
      { leadIds, memberId: target.id },
      manager.cookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ updated: 2 });
    expect(await owners(a, leadIds)).toEqual([target.id, target.id]);
    const rows = await fixture.scoped(a, (tx) =>
      tx.select().from(notifications).where(eq(notifications.userId, user.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "assigned",
      url: `/${slug}/today`,
      body: "2 leads were assigned to you.",
    });
  });

  it.each([
    ["a hostile origin", "https://evil.example.test"],
    ["no origin", null],
  ])("refuses %s and changes nothing", async (_name, origin) => {
    const { a, manager, target, leadIds, slug } = await setup();
    const response = await post(
      slug,
      { leadIds, memberId: target.id },
      manager.cookie,
      origin,
    );
    expect(response.statusCode).toBe(403);
    expect(await owners(a, leadIds)).toEqual([null, null]);
  });

  it("lets entered staff assign until the entry ends", async () => {
    const { a, target, leadIds, slug } = await setup();
    await fixture.companyRequest("POST", "enterCompany", a.cookie, {
      companyId: a.companyId,
      reason: "Handing out the new leads",
    });
    expect(
      (await post(slug, { leadIds, memberId: target.id }, a.cookie)).statusCode,
    ).toBe(200);
    fixture.advance(8 * 60 * minute);
    expect(
      (await post(slug, { leadIds, memberId: null }, a.cookie)).statusCode,
    ).toBe(403);
  });

  it.each([
    ["an Admin", "seller", {}, 403],
    [
      "501 leads",
      "manager",
      { leadIds: Array.from({ length: 501 }, () => v7()) },
      400,
    ],
    ["a lead twice", "manager", { leadIds: "twice" }, 400],
    ["a missing lead", "manager", { leadIds: "plusMissing" }, 404],
    ["a made-up member", "manager", { memberId: v7() }, 400],
    ["an extra key", "manager", { note: "x" }, 400],
  ] as const)("answers %s with %i", async (_name, who, change, status) => {
    const context = await setup();
    const payload: Record<string, unknown> = {
      leadIds: context.leadIds,
      memberId: context.target.id,
      ...change,
    };
    if ("leadIds" in change && change.leadIds === "twice")
      payload.leadIds = [context.leadIds[0], context.leadIds[0]];
    if ("leadIds" in change && change.leadIds === "plusMissing")
      payload.leadIds = [...context.leadIds, v7()];
    const response = await post(context.slug, payload, context[who].cookie);
    expect(response.statusCode).toBe(status);
    expect(await owners(context.a, context.leadIds)).toEqual([null, null]);
  });

  it("refuses other companies and no session", async () => {
    const { foreign, target, leadIds, slug } = await setup();
    const body = { leadIds, memberId: target.id };
    expect((await post(slug, body, foreign.cookie)).statusCode).toBe(404);
    expect((await post(slug, body)).statusCode).toBe(401);
  });
});
