import { fields, lostReasons, outcomes, stages } from "@anar/db/tenant";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  loadHistoricalReferences,
  readOutcomeFacts,
} from "../../src/modules/settings/index.js";
import { type SettingsFixture, startSettingsFixture } from "./fixture.js";

describe("historical settings references", () => {
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

  async function seed(target: { agencyId: string; companyId: string }) {
    const ids = { stage: v7(), outcome: v7(), reason: v7() };
    const archivedAt = fixture.now();
    const { companyId } = target;
    await fixture.scoped(target, async (tx) => {
      await tx.insert(fields).values({
        id: v7(),
        companyId,
        key: "old_unit",
        label: "Old unit",
        type: "dropdown",
        options: [{ value: "2bhk", label: "2 BHK" }],
        isSystem: false,
        position: 80,
        archivedAt,
      });
      await tx.insert(stages).values({
        id: ids.stage,
        companyId,
        name: "Old stage",
        position: 80,
        kind: "open",
        isDefault: false,
        archivedAt,
      });
      await tx.insert(outcomes).values({
        id: ids.outcome,
        companyId,
        name: "Old outcome",
        countsAsFailed: false,
        position: 80,
        archivedAt,
      });
      await tx.insert(lostReasons).values({
        id: ids.reason,
        companyId,
        name: "Old reason",
        position: 80,
        archivedAt,
      });
    });
    return ids;
  }

  it("reads archived rows asked for, and nothing else", async () => {
    const { a } = await fixture.setup();
    const ids = await seed(a);
    const refs = await fixture.scoped(a, (tx) =>
      loadHistoricalReferences(tx, {
        fieldKeys: ["old_unit"],
        stageIds: [ids.stage],
        outcomeIds: [ids.outcome],
        lostReasonIds: [ids.reason],
      }),
    );
    expect(refs.fields).toMatchObject([
      { key: "old_unit", label: "Old unit", archivedAt: fixture.now() },
    ]);
    expect(refs.stages).toMatchObject([{ id: ids.stage, name: "Old stage" }]);
    expect(refs.outcomes).toMatchObject([
      { id: ids.outcome, name: "Old outcome" },
    ]);
    expect(refs.lostReasons).toMatchObject([
      { id: ids.reason, name: "Old reason" },
    ]);
  });

  it("returns empty lists for an empty ask", async () => {
    const { a } = await fixture.setup();
    await seed(a);
    const refs = await fixture.scoped(a, (tx) =>
      loadHistoricalReferences(tx, {
        fieldKeys: [],
        stageIds: [],
        outcomeIds: [],
        lostReasonIds: [],
      }),
    );
    expect(refs).toEqual({
      fields: [],
      stages: [],
      outcomes: [],
      lostReasons: [],
    });
  });

  it("does not read another company's rows", async () => {
    const { a, b } = await fixture.setup();
    const ids = await seed(b);
    const refs = await fixture.scoped(a, (tx) =>
      loadHistoricalReferences(tx, {
        fieldKeys: ["old_unit"],
        stageIds: [ids.stage],
        outcomeIds: [ids.outcome],
        lostReasonIds: [ids.reason],
      }),
    );
    expect(refs).toEqual({
      fields: [],
      stages: [],
      outcomes: [],
      lostReasons: [],
    });
  });

  it("keeps the seeded site visit classification after a rename", async () => {
    const { a } = await fixture.setup();
    const [visit] = await fixture.scoped(a, (tx) =>
      tx.select().from(outcomes).where(eq(outcomes.seedKey, "site_visit_done")),
    );
    await fixture.scoped(a, (tx) =>
      tx
        .update(outcomes)
        .set({ name: "Visit completed" })
        .where(eq(outcomes.id, visit.id)),
    );
    expect(
      await fixture.scoped(a, (tx) => readOutcomeFacts(tx, visit.id)),
    ).toEqual({
      countsAsFailed: false,
      isSiteVisit: true,
    });
  });

  it("refuses archived and foreign outcomes for a new call", async () => {
    const { a, b } = await fixture.setup();
    const archived = await seed(a);
    const foreign = await seed(b);
    for (const id of [archived.outcome, foreign.outcome])
      await expect(
        fixture.scoped(a, (tx) => readOutcomeFacts(tx, id)),
      ).rejects.toMatchObject({ code: "validation" });
  });
});
