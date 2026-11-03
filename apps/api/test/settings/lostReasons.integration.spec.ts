import { leads, lostReasons } from "@anar/db/tenant";
import { ne } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type SettingsFixture, startSettingsFixture } from "./fixture.js";

describe("a manager maintains lost reasons", () => {
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
    const catalog = () => fixture.catalog(base.slug, base.manager.cookie);
    const named = async (name: string) => {
      const reason = (await catalog()).lostReasons.find(
        (row) => row.name === name,
      );
      if (!reason) throw new Error(`Expected the ${name} reason`);
      return reason;
    };
    return { ...base, post, catalog, named };
  }

  it("adds at the end and renames without changing the ID", async () => {
    const { post, named } = await setup();
    expect(
      (await post("upsertLostReason", { name: "Too Far" })).statusCode,
    ).toBe(200);
    expect(await named("Too Far")).toMatchObject({ position: 7 });
    const other = await named("Other");
    expect(
      (await post("upsertLostReason", { id: other.id, name: "Something Else" }))
        .statusCode,
    ).toBe(200);
    expect((await named("Something Else")).id).toBe(other.id);
    expect(
      (await post("upsertLostReason", { name: "Changed Mind" })).statusCode,
    ).toBe(409);
  });

  it("archives once and an old lost lead keeps the reason", async () => {
    const { a, slug, seller, post, catalog, named } = await setup();
    const reason = await named("Too Expensive");
    const lost = (await catalog()).stages.find(
      (stage) => stage.kind === "lost",
    );
    if (!lost) throw new Error("Expected the Lost stage");
    await fixture.addLead(a, lost.id, { lostReasonId: reason.id });
    for (let i = 0; i < 2; i++)
      expect(
        (await post("archiveLostReason", { lostReasonId: reason.id }))
          .statusCode,
      ).toBe(200);
    expect(await fixture.audits("settings.reason_archived")).toEqual([
      { target_id: reason.id },
    ]);
    const kept = await fixture.scoped(a, (tx) =>
      tx.select({ lostReasonId: leads.lostReasonId }).from(leads),
    );
    expect(kept).toEqual([{ lostReasonId: reason.id }]);
    expect((await named("Too Expensive")).archivedAt).not.toBeNull();
    const choices = await fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/settings/loadSchema`,
      headers: { cookie: seller.cookie },
    });
    expect(
      choices.json().data.lostReasons.map((row: { id: string }) => row.id),
    ).not.toContain(reason.id);
    expect(
      (await post("upsertLostReason", { name: "Too Expensive" })).statusCode,
    ).toBe(409);
  });

  it("keeps at least one active reason", async () => {
    const { a, post, named } = await setup();
    const last = await named("Other");
    await fixture.scoped(a, (tx) =>
      tx
        .update(lostReasons)
        .set({ archivedAt: fixture.now() })
        .where(ne(lostReasons.id, last.id)),
    );
    expect(
      (await post("archiveLostReason", { lostReasonId: last.id })).statusCode,
    ).toBe(409);
  });

  it("hides another company's reason and refuses an Admin or a stale code", async () => {
    const { seller, foreign, foreignSlug, post, named } = await setup();
    const reason = await named("Other");
    expect(
      (
        await fixture.post(foreignSlug, foreign.cookie, "archiveLostReason", {
          lostReasonId: reason.id,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await post("upsertLostReason", { name: "Far" }, seller.cookie))
        .statusCode,
    ).toBe(403);
    fixture.advance(900001);
    expect((await post("upsertLostReason", { name: "Far" })).statusCode).toBe(
      428,
    );
    expect(await fixture.audits("settings.reason_saved")).toEqual([]);
  });
});
