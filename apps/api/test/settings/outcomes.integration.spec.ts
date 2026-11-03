import { outcomes } from "@anar/db/tenant";
import { ne } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type SettingsFixture, startSettingsFixture } from "./fixture.js";

describe("a manager maintains call outcomes", () => {
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
    const post = (
      operation: string,
      payload: object,
      cookie = base.manager.cookie,
    ) => fixture.post(base.slug, cookie, operation, payload);
    const list = async () =>
      (await fixture.catalog(base.slug, base.manager.cookie)).outcomes;
    const named = async (name: string) => {
      const outcome = (await list()).find((row) => row.name === name);
      if (!outcome) throw new Error(`Expected the ${name} outcome`);
      return outcome;
    };
    return { ...base, post, list, named };
  }

  it("adds at the end, renames in place and changes the failed flag", async () => {
    const { post, named } = await setup();
    expect(
      (
        await post("upsertOutcome", {
          name: "Wrong Number",
          countsAsFailed: true,
        })
      ).statusCode,
    ).toBe(200);
    const added = await named("Wrong Number");
    expect(added).toMatchObject({ position: 10, countsAsFailed: true });
    const noAnswer = await named("No Answer");
    expect(
      (
        await post("upsertOutcome", {
          id: noAnswer.id,
          name: "No Pickup",
          countsAsFailed: false,
        })
      ).statusCode,
    ).toBe(200);
    expect(await named("No Pickup")).toMatchObject({
      id: noAnswer.id,
      countsAsFailed: false,
    });
    expect(await fixture.audits("settings.outcome_saved")).toHaveLength(2);
  });

  it("refuses a duplicate name, archived rows included", async () => {
    const { post, named } = await setup();
    const budget = await named("Budget Discussion");
    expect(
      (await post("archiveOutcome", { outcomeId: budget.id })).statusCode,
    ).toBe(200);
    for (const name of ["No Answer", "Budget Discussion"])
      expect(
        (await post("upsertOutcome", { name, countsAsFailed: false }))
          .statusCode,
      ).toBe(409);
  });

  it("archives once, hides it from call choices and keeps the last one", async () => {
    const { a, slug, seller, post, named, list } = await setup();
    const done = await named("Document Submitted");
    expect(
      (await post("archiveOutcome", { outcomeId: done.id })).statusCode,
    ).toBe(200);
    expect(
      (await post("archiveOutcome", { outcomeId: done.id })).statusCode,
    ).toBe(200);
    expect(await fixture.audits("settings.outcome_archived")).toEqual([
      { target_id: done.id },
    ]);
    const choices = await fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/settings/loadSchema`,
      headers: { cookie: seller.cookie },
    });
    expect(
      choices.json().data.outcomes.map((row: { id: string }) => row.id),
    ).not.toContain(done.id);
    const last = await named("Connected - High Interest");
    await fixture.scoped(a, (tx) =>
      tx
        .update(outcomes)
        .set({ archivedAt: fixture.now() })
        .where(ne(outcomes.id, last.id)),
    );
    expect(
      (await post("archiveOutcome", { outcomeId: last.id })).statusCode,
    ).toBe(409);
    expect(
      (await list()).filter((row) => row.archivedAt === null),
    ).toHaveLength(1);
  });

  it("refuses an Admin and a stale code", async () => {
    const { seller, post } = await setup();
    const input = { name: "Busy", countsAsFailed: true };
    expect((await post("upsertOutcome", input, seller.cookie)).statusCode).toBe(
      403,
    );
    fixture.advance(900001);
    expect((await post("upsertOutcome", input)).statusCode).toBe(428);
    expect(await fixture.audits("settings.outcome_saved")).toEqual([]);
  });
});
