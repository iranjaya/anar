import { leads } from "@anar/db/tenant";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type SettingsFixture, startSettingsFixture } from "./fixture.js";

describe("a manager edits or archives a field without losing lead answers", () => {
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

  const choices = [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ];
  async function setup() {
    const base = await fixture.setup();
    const created = await fixture.post(
      base.slug,
      base.manager.cookie,
      "createField",
      {
        label: "Has parking",
        type: "dropdown",
        options: choices,
      },
    );
    const fieldId = created.json().data.fieldId as string;
    const catalog = await fixture.catalog(base.slug, base.manager.cookie);
    const stageId = catalog.stages[0].id;
    const update = (payload: object) =>
      fixture.post(base.slug, base.manager.cookie, "updateField", {
        fieldId,
        ...payload,
      });
    const archive = (id = fieldId) =>
      fixture.post(base.slug, base.manager.cookie, "archiveField", {
        fieldId: id,
      });
    const field = async () =>
      (await fixture.catalog(base.slug, base.manager.cookie)).fields.find(
        (row) => row.id === fieldId,
      );
    return { ...base, fieldId, stageId, update, archive, field };
  }

  it("replaces the type and codes of a field no lead uses yet", async () => {
    const { update, field } = await setup();
    expect((await update({ definition: { type: "text" } })).statusCode).toBe(
      200,
    );
    expect(await field()).toMatchObject({ type: "text", options: null });
  });

  it("keeps the type and codes once a lead has an answer, even 0", async () => {
    const { a, stageId, update, field } = await setup();
    await fixture.addLead(a, stageId, { custom: { has_parking: 0 } });
    for (const definition of [
      { type: "text" },
      { type: "dropdown", options: [choices[0]] },
      { type: "dropdown", options: [{ value: "y", label: "Yes" }, choices[1]] },
    ]) {
      const response = await update({ definition });
      expect(response.statusCode).toBe(409);
    }
    const renamed = await update({
      label: "Parking",
      definition: {
        type: "dropdown",
        options: [
          { value: "yes", label: "Yes, covered" },
          choices[1],
          { value: "maybe", label: "Maybe" },
        ],
      },
    });
    expect(renamed.statusCode).toBe(200);
    expect(await field()).toMatchObject({
      label: "Parking",
      options: [
        { value: "yes", label: "Yes, covered" },
        choices[1],
        { value: "maybe", label: "Maybe" },
      ],
    });
    expect(await fixture.audits("settings.field_updated")).toHaveLength(1);
  });

  it("archives once, keeps lead answers and drops the field from active choices", async () => {
    const { a, slug, manager, seller, stageId, fieldId, archive, field } =
      await setup();
    await fixture.addLead(a, stageId, { custom: { has_parking: "yes" } });
    expect((await archive()).statusCode).toBe(200);
    expect((await archive()).statusCode).toBe(200);
    expect((await field())?.archivedAt).not.toBeNull();
    expect(await fixture.audits("settings.field_archived")).toEqual([
      { target_id: fieldId },
    ]);
    const answers = await fixture.scoped(a, (tx) =>
      tx.select({ custom: leads.custom }).from(leads),
    );
    expect(answers).toEqual([{ custom: { has_parking: "yes" } }]);
    const active = await fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/settings/loadSchema`,
      headers: { cookie: seller.cookie },
    });
    expect(
      active.json().data.fields.map((row: { key: string }) => row.key),
    ).not.toContain("has_parking");
    const again = await fixture.post(slug, manager.cookie, "createField", {
      key: "has_parking",
      label: "Parking again",
      type: "text",
    });
    expect(again.statusCode).toBe(409);
  });

  it("refuses to archive a scoring field or change its codes", async () => {
    const { slug, manager, archive } = await setup();
    const catalog = await fixture.catalog(slug, manager.cookie);
    const budget = catalog.fields.find((row) => row.key === "budget_fit");
    if (!budget) throw new Error("Expected the budget_fit default");
    expect((await archive(budget.id)).statusCode).toBe(409);
    const changed = await fixture.post(slug, manager.cookie, "updateField", {
      fieldId: budget.id,
      definition: {
        type: "dropdown",
        options: [{ value: "Yes", label: "Yes" }],
      },
    });
    expect(changed.statusCode).toBe(409);
    const renamed = await fixture.post(slug, manager.cookie, "updateField", {
      fieldId: budget.id,
      label: "Budget ok",
    });
    expect(renamed.statusCode).toBe(200);
  });

  it("hides another company's field and refuses an Admin or a stale code", async () => {
    const { slug, seller, foreign, foreignSlug, fieldId, update } =
      await setup();
    const outside = await fixture.post(
      foreignSlug,
      foreign.cookie,
      "archiveField",
      { fieldId },
    );
    expect(outside.statusCode).toBe(404);
    expect(
      (
        await fixture.post(slug, seller.cookie, "updateField", {
          fieldId,
          label: "X",
        })
      ).statusCode,
    ).toBe(403);
    fixture.advance(900001);
    expect((await update({ label: "Late" })).statusCode).toBe(428);
    expect(await fixture.audits("settings.field_updated")).toEqual([]);
  });
});
