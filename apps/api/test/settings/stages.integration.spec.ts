import { stages } from "@anar/db/tenant";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type SettingsFixture, startSettingsFixture } from "./fixture.js";

describe("a manager adds or renames a stage", () => {
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
    const save = (payload: object, cookie = base.manager.cookie) =>
      fixture.post(base.slug, cookie, "upsertStage", payload);
    const list = async () =>
      (await fixture.catalog(base.slug, base.manager.cookie)).stages;
    const named = async (name: string) => {
      const stage = (await list()).find((row) => row.name === name);
      if (!stage) throw new Error(`Expected the ${name} stage`);
      return stage;
    };
    return { ...base, save, list, named };
  }

  it("adds a stage at the end and renames it without changing its ID", async () => {
    const { save, list, named } = await setup();
    const added = await save({
      name: "Visit Booked",
      kind: "open",
      isDefault: false,
    });
    expect(added.statusCode).toBe(200);
    const stage = await named("Visit Booked");
    expect(stage.position).toBe(8);
    expect(
      (
        await save({
          id: stage.id,
          name: "Visit Set",
          kind: "open",
          isDefault: false,
        })
      ).statusCode,
    ).toBe(200);
    expect((await list()).find((row) => row.id === stage.id)?.name).toBe(
      "Visit Set",
    );
    expect(await fixture.audits("settings.stage_saved")).toHaveLength(2);
  });

  it("moves the default in one step and never leaves none", async () => {
    const { save, list, named } = await setup();
    const contacted = await named("Contacted");
    expect(
      (
        await save({
          id: contacted.id,
          name: "Contacted",
          kind: "open",
          isDefault: true,
        })
      ).statusCode,
    ).toBe(200);
    const defaults = (await list()).filter((row) => row.isDefault);
    expect(defaults.map((row) => row.id)).toEqual([contacted.id]);
    const cleared = await save({
      id: contacted.id,
      name: "Contacted",
      kind: "open",
      isDefault: false,
    });
    expect(cleared.statusCode).toBe(409);
    const won = await save({ name: "Won Fast", kind: "won", isDefault: true });
    expect(won.statusCode).toBe(409);
  });

  it("leaves exactly one default after two swaps at once", async () => {
    const { save, list, named } = await setup();
    const [a, b] = await Promise.all([named("Contacted"), named("Qualified")]);
    const responses = await Promise.all([
      save({ id: a.id, name: a.name, kind: "open", isDefault: true }),
      save({ id: b.id, name: b.name, kind: "open", isDefault: true }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200,
    ]);
    expect((await list()).filter((row) => row.isDefault)).toHaveLength(1);
  });

  it("refuses a duplicate name, archived rows included", async () => {
    const { a, save } = await setup();
    await fixture.scoped(a, (tx) =>
      tx
        .update(stages)
        .set({ archivedAt: fixture.now() })
        .where(eq(stages.name, "Negotiation")),
    );
    for (const name of ["Contacted", "Negotiation"])
      expect(
        (await save({ name, kind: "open", isDefault: false })).statusCode,
      ).toBe(409);
  });

  it("refuses a type change on a used stage or on the last won stage", async () => {
    const { a, save, named } = await setup();
    const site = await named("Site Visit");
    await fixture.addLead(a, site.id);
    expect(
      (
        await save({
          id: site.id,
          name: site.name,
          kind: "won",
          isDefault: false,
        })
      ).statusCode,
    ).toBe(409);
    const booked = await named("Booked");
    expect(
      (
        await save({
          id: booked.id,
          name: booked.name,
          kind: "open",
          isDefault: false,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await save({ name: "Sold", kind: "won", isDefault: false })).statusCode,
    ).toBe(200);
    expect(
      (
        await save({
          id: booked.id,
          name: booked.name,
          kind: "open",
          isDefault: false,
        })
      ).statusCode,
    ).toBe(200);
  });

  it("refuses an Admin and a stale code", async () => {
    const { seller, save } = await setup();
    const input = { name: "Later", kind: "open", isDefault: false };
    expect((await save(input, seller.cookie)).statusCode).toBe(403);
    fixture.advance(900001);
    expect((await save(input)).statusCode).toBe(428);
    expect(await fixture.audits("settings.stage_saved")).toEqual([]);
  });
});
