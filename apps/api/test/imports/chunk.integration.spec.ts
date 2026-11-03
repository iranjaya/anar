import {
  fields,
  importBatches,
  importRows,
  leadEvents,
  leads,
  stages,
  type TenantTx,
} from "@anar/db/tenant";
import type { Mapping } from "@anar/domain/imports";
import { asc, eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import chunk, { type ImportJobDeps } from "../../src/modules/imports/chunk.js";
import mapping from "../../src/modules/imports/mapping.js";
import normalize from "../../src/modules/imports/normalize.js";
import type { ChunkRow } from "../../src/modules/imports/types.js";
import { addImportedLeads } from "../../src/modules/leads/index.js";
import {
  loadActiveConfig,
  scoreLead,
} from "../../src/modules/scoring/index.js";
import { loadSchema } from "../../src/modules/settings/index.js";
import {
  type ImportJobCtx,
  importJobs,
} from "../../src/modules/tenant/index.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";
import { company, seedRun } from "./runFixture.js";

type Target = { agencyId: string; companyId: string };
type Payload = Target & { actorUserId: string; batchId: string; runId: string };

const headers = ["full_name", "phone", "created_time", "campaign_name"];
const columns = mapping.headerColumns(headers);
const map: Mapping = [
  { header: "full_name", target: "system:full_name" },
  { header: "phone", target: "system:phone" },
  { header: "created_time", target: "system:lead_date" },
  { header: "campaign_name", target: "system:campaign_name" },
];
const at = "2026-09-12T10:11:12+05:45";
const leadDate = new Date("2026-09-12T04:26:12.000Z");
const phone = (n: number) => `+97798410${String(n).padStart(5, "0")}`;
const deps: ImportJobDeps = {
  loadSchema,
  loadActiveConfig,
  scoreLead,
  addImportedLeads,
};

describe("an import chunk is written exactly once", () => {
  let fixture: SettingsFixture;
  let runner: Awaited<ReturnType<typeof importJobs.start>>;
  beforeAll(async () => {
    fixture = await startSettingsFixture();
    runner = await importJobs.start(fixture.postgres.appUrl);
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await runner?.close();
    await fixture?.close();
  });

  async function setup() {
    const base = await fixture.setup();
    const payload = await seedRun(fixture, base.a, base.a.user.id);
    return { ...base, payload };
  }
  const rows = (lines: string[][], from = 1): ChunkRow[] =>
    lines.map((row, index) => ({
      rowNo: from + index,
      raw: Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])),
      normalized: normalize.normaliseRow({
        row,
        columns,
        mapping: map,
        fields: [],
        ...company,
        importedAt: fixture.now(),
      }),
    }));
  const line = (n: number | string, campaign = "Spring") => [
    `Lead ${n}`,
    typeof n === "number" ? phone(n) : n,
    at,
    campaign,
  ];
  const commit = (
    payload: Payload,
    chunkRows: ChunkRow[],
    after?: (tx: TenantTx) => Promise<void>,
  ) =>
    runner.withImportJob(payload, async (tx, current) => {
      const stop = await chunk.commitChunk(deps, tx, current, {
        rows: chunkRows,
        throughRowNo: chunkRows.at(-1)?.rowNo ?? 0,
      });
      await after?.(tx);
      return stop;
    });
  const stored = (target: Target) =>
    fixture.scoped(target, async (tx) => ({
      leads: await tx.select().from(leads).orderBy(asc(leads.phoneE164)),
      events: await tx.select().from(leadEvents),
      rows: await tx.select().from(importRows).orderBy(asc(importRows.rowNo)),
      batches: await tx.select().from(importBatches),
    }));
  const results = (list: { result: string; reason: string | null }[]) =>
    list.map((row) =>
      row.reason ? `${row.result}:${row.reason}` : row.result,
    );

  it("holds the company lock between field validation and the chunk write", async () => {
    const base = await fixture.setup();
    const fieldId = v7();
    await fixture.scoped(base.a, (tx) =>
      tx.insert(fields).values({
        id: fieldId,
        companyId: base.a.companyId,
        key: "unused_answer",
        label: "Unused answer",
        type: "text",
        isSystem: false,
        position: 99,
      }),
    );
    const payload = await seedRun(fixture, base.a, base.a.user.id);
    let ready = () => {};
    let release = () => {};
    const validated = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const continued = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inputRows = rows([line(1)]);
    inputRows[0].normalized.lead.custom = { unused_answer: "not a number" };
    const writing = runner.withImportJob(payload, (tx, current) =>
      chunk.commitChunk(
        {
          ...deps,
          async loadSchema(scoped) {
            const schema = await loadSchema(scoped);
            ready();
            await continued;
            return schema;
          },
        },
        tx,
        current,
        { rows: inputRows, throughRowNo: 1 },
      ),
    );
    await validated;
    let refused = false;
    try {
      await fixture.scoped(base.a, async (tx) => {
        await tx.execute(
          sql`SELECT id FROM companies WHERE id=${base.a.companyId} FOR UPDATE NOWAIT`,
        );
        await tx
          .update(fields)
          .set({ type: "number" })
          .where(eq(fields.id, fieldId));
      });
    } catch (error) {
      const outer = error as { code?: string; cause?: { code?: string } };
      expect(outer.code ?? outer.cause?.code).toBe("55P03");
      refused = true;
    } finally {
      release();
      await writing;
    }
    expect(refused).toBe(true);
    const [field] = await fixture.scoped(base.a, (tx) =>
      tx.select().from(fields).where(eq(fields.id, fieldId)),
    );
    expect(field.type).toBe("text");
    expect((await stored(base.a)).leads[0].custom).toEqual({
      unused_answer: "not a number",
    });
  });

  it("keeps a phone from chunk one as a file duplicate in chunk two", async () => {
    const { a, payload } = await setup();
    const first = rows([
      line(1),
      line("p:123"),
      [...line(3), "extra"],
      ...Array.from({ length: 497 }, (_, n) => line(n + 10)),
    ]);
    expect(await commit(payload, first)).toBeNull();
    expect(
      await commit(payload, rows([line(1), line("p:123")], 501)),
    ).toBeNull();
    const saved = await stored(a);
    expect(saved.batches[0].lastRowNo).toBe(502);
    expect(saved.rows).toHaveLength(502);
    expect(results(saved.rows.slice(0, 3))).toEqual([
      "imported",
      "imported:invalid_phone",
      "invalid",
    ]);
    expect(results(saved.rows.slice(500))).toEqual([
      "duplicate_file",
      "imported:invalid_phone",
    ]);
    expect(saved.leads).toHaveLength(500);
    expect(saved.events.map((event) => event.type)).toEqual(
      Array(500).fill("imported"),
    );
    expect(saved.events[0]).toMatchObject({
      actorUserId: payload.actorUserId,
      actorMemberId: null,
    });
  });

  it("does nothing when a committed chunk comes again", async () => {
    const { a, payload } = await setup();
    const chunkRows = rows([line(1), line("p:123"), line(1)]);
    await commit(payload, chunkRows);
    const before = await stored(a);
    expect(await commit(payload, chunkRows)).toBeNull();
    expect(await stored(a)).toEqual(before);
    expect(before.leads).toHaveLength(2);
  });

  it("keeps nothing when the process dies before the commit", async () => {
    const { a, payload } = await setup();
    const chunkRows = rows([line(1), line(2)]);
    await expect(
      commit(payload, chunkRows, async () => {
        throw new Error("worker died");
      }),
    ).rejects.toThrow("worker died");
    const empty = await stored(a);
    expect([empty.leads, empty.events, empty.rows]).toEqual([[], [], []]);
    expect(empty.batches[0].lastRowNo).toBe(0);
    await commit(payload, chunkRows);
    expect((await stored(a)).leads).toHaveLength(2);
  });

  it("keeps an existing lead as it is and adds an event only for a changed submission", async () => {
    const { a, payload } = await setup();
    const stageId = (
      await fixture.scoped(a, (tx) => tx.select().from(stages).limit(1))
    )[0].id;
    for (const n of [1, 2])
      await fixture.addLead(a, stageId, {
        phoneE164: phone(n),
        phoneValid: true,
        fullName: `Kept ${n}`,
        campaignName: "Spring",
        leadDate,
      });
    await commit(payload, rows([line(1), line(2, "Autumn")]));
    const saved = await stored(a);
    expect(results(saved.rows)).toEqual([
      "duplicate_db:same_submission",
      "duplicate_db:resubmitted",
    ]);
    expect(saved.rows.map((row) => row.leadId)).toEqual(
      saved.leads.map((lead) => lead.id),
    );
    expect(saved.leads.map((lead) => lead.fullName)).toEqual([
      "Kept 1",
      "Kept 2",
    ]);
    expect(saved.events).toEqual([
      expect.objectContaining({
        leadId: saved.leads[1].id,
        type: "duplicate_import",
        data: {
          batchId: payload.batchId,
          rowNo: 2,
          campaignName: "Autumn",
          leadDate: leadDate.toISOString(),
        },
      }),
    ]);
  });

  it("gives each phone one lead when two imports write it at once", async () => {
    const { a, payload } = await setup();
    const other = await seedRun(fixture, a, payload.actorUserId);
    const phones = Array.from({ length: 50 }, (_, n) => line(n + 1));
    await Promise.all([
      commit(payload, rows(phones)),
      commit(other, rows([...phones].reverse())),
    ]);
    const saved = await stored(a);
    expect(saved.leads).toHaveLength(50);
    expect(saved.rows).toHaveLength(100);
    expect(saved.rows.filter((row) => row.result === "imported")).toHaveLength(
      50,
    );
    expect(
      saved.rows.filter((row) => row.reason === "same_submission"),
    ).toHaveLength(50);
    expect(saved.events).toHaveLength(50);
  });

  it("writes no lead when the result rows cannot be saved", async () => {
    const { a, payload } = await setup();
    await fixture.owner("REVOKE INSERT ON import_rows FROM anar_app");
    try {
      await expect(commit(payload, rows([line(1)]))).rejects.toThrow();
    } finally {
      await fixture.owner("GRANT INSERT ON import_rows TO anar_app");
    }
    const saved = await stored(a);
    expect([saved.leads, saved.events, saved.rows]).toEqual([[], [], []]);
  });

  it("stops for review when a company field changed after commit", async () => {
    const { a, payload } = await setup();
    await fixture.scoped(a, (tx) =>
      tx.insert(fields).values({
        id: v7(),
        companyId: a.companyId,
        key: "budget",
        label: "Budget",
        type: "number",
        isSystem: false,
        position: 10,
      }),
    );
    expect(await commit(payload, rows([line(1)]))).toBe("schema_changed");
    expect((await stored(a)).leads).toEqual([]);
  });

  it("writes nothing for a run that is no longer active", async () => {
    const { a, payload } = await setup();
    const stale = (await fixture.scoped(a, (tx) =>
      chunk.commitChunk(
        deps,
        tx,
        {
          ...payload,
          runId: v7(),
          actorMemberId: null,
          company,
        } as ImportJobCtx,
        { rows: rows([line(1)]), throughRowNo: 1 },
      ),
    )) as string;
    expect(stale).toBe("stale");
    expect((await stored(a)).leads).toEqual([]);
  });

  it("keeps the rows inside the company that imported them", async () => {
    const { a, b, payload } = await setup();
    await commit(payload, rows([line(1)]));
    expect((await stored(a)).leads).toHaveLength(1);
    const foreign = await stored(b);
    expect([foreign.leads, foreign.rows, foreign.batches]).toEqual([
      [],
      [],
      [],
    ]);
    await expect(
      commit({ ...payload, ...b }, rows([line(2)], 2)),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
