import { importRows, importRuns } from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";
import { seedRun } from "./runFixture.js";

type Target = { agencyId: string; companyId: string };
type Row = {
  result: string;
  reason?: string | null;
  raw?: Record<string, string> | null;
};

describe("an import report shows progress and every result row", () => {
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

  const read = (slug: string, cookie: string, path: string) =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/imports/${path}`,
      headers: { cookie },
    });
  async function setup(rows: Row[] = []) {
    const base = await fixture.setup();
    const entered = await fixture.companyRequest(
      "POST",
      "enterCompany",
      base.a.cookie,
      { companyId: base.a.companyId, reason: "Reading the import report" },
    );
    expect(entered.statusCode).toBe(200);
    const payload = await seedRun(fixture, base.a, base.a.user.id, {
      rowCount: rows.length,
    });
    if (rows.length > 0)
      await fixture.scoped(base.a, (tx) =>
        tx.insert(importRows).values(
          rows.map((row, index) => ({
            id: v7(),
            companyId: base.a.companyId,
            batchId: payload.batchId,
            rowNo: index + 1,
            raw: row.raw === undefined ? { phone: `${index + 1}` } : row.raw,
            result: row.result as "imported",
            reason: row.reason ?? null,
            issues: [],
          })),
        ),
      );
    const get = (path: string, cookie = base.a.cookie) =>
      read(base.slug, cookie, `${path}batchId=${payload.batchId}`);
    return { ...base, payload, get };
  }
  const setRun = (
    target: Target,
    runId: string,
    set: Partial<typeof importRuns.$inferInsert>,
  ) =>
    fixture.scoped(target, (tx) =>
      tx.update(importRuns).set(set).where(eq(importRuns.id, runId)),
    );
  const rowNos = (body: { data: { items: { rowNo: number }[] } }) =>
    body.data.items.map((row) => row.rowNo);

  it("pages 50 rows at a time in row order and counts the whole file", async () => {
    const { get } = await setup(
      Array.from({ length: 51 }, () => ({ result: "duplicate_file" })),
    );
    const first = (await get("listImportRows?")).json();
    expect(rowNos(first)).toEqual(Array.from({ length: 50 }, (_, n) => n + 1));
    expect(first.data).toMatchObject({ nextRowNo: 50, total: 51 });
    const second = (await get("listImportRows?afterRowNo=50&")).json();
    expect(rowNos(second)).toEqual([51]);
    expect(second.data).toMatchObject({ nextRowNo: null, total: 51 });
  });

  it("gives an empty page for a batch with no rows yet, and exactly 50 with no next page", async () => {
    const empty = await setup();
    expect((await empty.get("listImportRows?")).json().data).toEqual({
      items: [],
      nextRowNo: null,
      total: 0,
    });
    await fixture.reset();
    const fifty = await setup(
      Array.from({ length: 50 }, () => ({ result: "invalid" })),
    );
    expect((await fifty.get("listImportRows?")).json().data).toMatchObject({
      nextRowNo: null,
      total: 50,
    });
  });

  it("splits rows into exceptions, phone review and all", async () => {
    const { get } = await setup([
      { result: "imported" },
      { result: "imported", reason: "invalid_phone" },
      { result: "duplicate_db", reason: "resubmitted" },
      { result: "duplicate_db", reason: "same_submission" },
      { result: "duplicate_file" },
      { result: "invalid", raw: null },
    ]);
    expect(rowNos((await get("listImportRows?")).json())).toEqual([
      2, 3, 4, 5, 6,
    ]);
    expect(
      rowNos((await get("listImportRows?filter=phone_review&")).json()),
    ).toEqual([2]);
    const all = (await get("listImportRows?filter=all&")).json();
    expect(rowNos(all)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(all.data.items[5].raw).toBeNull();
  });

  it("shows queued, then stopped for a failed or lost job, without writing", async () => {
    const { a, payload, get } = await setup();
    const jobId = v7();
    await setRun(a, payload.runId, { jobId });
    const report = async () => (await get("getImportBatch?")).json().data;
    expect(await report()).toMatchObject({
      runState: "queued",
      error: null,
      canResume: false,
    });
    await fixture.owner(
      `INSERT INTO pgboss.job (id, name, data, state) VALUES ('${jobId}', 'import.commit', '{}', 'failed')`,
    );
    const before = await fixture.scoped(a, (tx) =>
      tx.select().from(importRuns),
    );
    expect(await report()).toMatchObject({
      runState: "stopped",
      error: { code: "processing_failed" },
      canResume: true,
    });
    expect(
      await fixture.scoped(a, (tx) => tx.select().from(importRuns)),
    ).toEqual(before);
    await fixture.owner(`DELETE FROM pgboss.job WHERE id = '${jobId}'`);
    expect((await report()).runState).toBe("queued");
    fixture.advance(21 * 60_000);
    expect((await report()).runState).toBe("stopped");
  });

  it("names why a stopped run can or cannot resume", async () => {
    const { a, payload, get } = await setup();
    await setRun(a, payload.runId, {
      state: "stopped",
      stopCode: "schema_changed",
    });
    const stopped = (await get("getImportBatch?")).json().data;
    expect(stopped).toMatchObject({
      runState: "stopped",
      canResume: false,
      error: { code: "schema_changed" },
    });
    expect(stopped.error.message).toContain("check it again");
    expect(JSON.stringify(stopped)).not.toContain("imports/");
  });

  it("lets a manager read results with import off, and refuses an Admin and another company", async () => {
    const { manager, seller, foreignSlug, payload, get } = await setup([
      { result: "imported" },
    ]);
    expect((await get("getImportBatch?", manager.cookie)).statusCode).toBe(200);
    expect((await get("listImportRows?", manager.cookie)).statusCode).toBe(200);
    expect((await get("getImportBatch?", seller.cookie)).statusCode).toBe(403);
    const foreign = await read(
      foreignSlug,
      manager.cookie,
      `getImportBatch?batchId=${payload.batchId}`,
    );
    expect([403, 404]).toContain(foreign.statusCode);
  });

  it("treats a batch ID from another company as missing", async () => {
    const { b, slug, a } = await setup();
    const other = await seedRun(fixture, b, a.user.id);
    expect(
      (await read(slug, a.cookie, `getImportBatch?batchId=${other.batchId}`))
        .statusCode,
    ).toBe(404);
  });

  it("reads without changing the batch", async () => {
    const { get } = await setup([{ result: "imported" }]);
    const before = await fixture.rows(sql`select * from import_batches`);
    await get("getImportBatch?");
    await get("listImportRows?");
    expect(await fixture.rows(sql`select * from import_batches`)).toEqual(
      before,
    );
  });
});
