import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type SettingsFixture, startSettingsFixture } from "./fixture.js";

describe("a manager reorders or archives stages", () => {
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
    const post = (operation: string, payload: object) =>
      fixture.post(base.slug, base.manager.cookie, operation, payload);
    const active = async () =>
      (await fixture.catalog(base.slug, base.manager.cookie)).stages.filter(
        (stage) => stage.archivedAt === null,
      );
    const named = async (name: string) => {
      const stage = (await active()).find((row) => row.name === name);
      if (!stage) throw new Error(`Expected the ${name} stage`);
      return stage;
    };
    return { ...base, post, active, named };
  }

  it("saves a new order with contiguous positions and one audit", async () => {
    const { post, active } = await setup();
    const ids = (await active()).map((stage) => stage.id);
    const reversed = [...ids].reverse();
    expect(
      (await post("reorderStages", { stageIds: reversed })).statusCode,
    ).toBe(200);
    expect((await active()).map((stage) => [stage.id, stage.position])).toEqual(
      reversed.map((id, index) => [id, index]),
    );
    expect(
      (await post("reorderStages", { stageIds: reversed })).statusCode,
    ).toBe(200);
    expect(await fixture.audits("settings.stages_reordered")).toHaveLength(1);
  });

  it("refuses a missing, extra, repeated or foreign stage and writes nothing", async () => {
    const { post, active, foreign, foreignSlug } = await setup();
    const ids = (await active()).map((stage) => stage.id);
    const outside = (await fixture.catalog(foreignSlug, foreign.cookie))
      .stages[0].id;
    for (const stageIds of [
      ids.slice(1),
      [...ids, v7()],
      [...ids.slice(1), outside],
      [ids[0], ...ids.slice(0, -1)],
    ]) {
      const response = await post("reorderStages", { stageIds });
      expect([400, 409]).toContain(response.statusCode);
    }
    expect((await active()).map((stage) => stage.id)).toEqual(ids);
    expect(await fixture.audits("settings.stages_reordered")).toEqual([]);
  });

  it("archives an unused stage once and refuses the default, a used one and the last ending", async () => {
    const { a, post, active, named } = await setup();
    const qualified = await named("Qualified");
    expect(
      (await post("archiveStage", { stageId: qualified.id })).statusCode,
    ).toBe(200);
    expect(
      (await post("archiveStage", { stageId: qualified.id })).statusCode,
    ).toBe(200);
    expect(await fixture.audits("settings.stage_archived")).toEqual([
      { target_id: qualified.id },
    ]);
    const site = await named("Site Visit");
    await fixture.addLead(a, site.id);
    for (const name of ["New Lead", "Site Visit", "Booked", "Lost"]) {
      const stage = await named(name);
      expect(
        (await post("archiveStage", { stageId: stage.id })).statusCode,
      ).toBe(409);
    }
    const left = await active();
    expect(left.map((stage) => stage.name)).not.toContain("Qualified");
    expect(left).toHaveLength(7);
    const reordered = await post("reorderStages", {
      stageIds: left.map((stage) => stage.id).reverse(),
    });
    expect(reordered.statusCode).toBe(200);
  });

  it("does not lose a stage added while another manager reorders", async () => {
    const { post, active } = await setup();
    const ids = (await active()).map((stage) => stage.id);
    const [added, reordered] = await Promise.all([
      post("upsertStage", {
        name: "Visit Set",
        kind: "open",
        isDefault: false,
      }),
      post("reorderStages", { stageIds: [...ids].reverse() }),
    ]);
    expect(added.statusCode).toBe(200);
    expect([200, 409]).toContain(reordered.statusCode);
    const names = (await active()).map((stage) => stage.name);
    expect(names).toContain("Visit Set");
    expect(new Set((await active()).map((stage) => stage.position)).size).toBe(
      names.length,
    );
  });
});
