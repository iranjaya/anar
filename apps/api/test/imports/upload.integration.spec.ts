import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { importBatches, importRows, leads, stages } from "@anar/db/tenant";
import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { publicOrigin } from "../auth/fixture.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

const minute = 60_000;
const meta = join(import.meta.dirname, "../fixtures/csv/meta-utf16le-tab.csv");

describe("upload keeps the file and batch only for an allowed person", () => {
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

  function body(
    fileName: string,
    type: string | null,
    bytes: Uint8Array,
  ): { boundary: string; head: Buffer; tail: Buffer; bytes: Uint8Array } {
    const boundary = `anar-${v7()}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n${type ? `Content-Type: ${type}\r\n` : ""}\r\n`,
    );
    return {
      boundary,
      head,
      tail: Buffer.from(`\r\n--${boundary}--\r\n`),
      bytes,
    };
  }
  function upload(
    slug: string,
    cookie: string | null,
    bytes: Uint8Array,
    options: {
      fileName?: string;
      type?: string | null;
      origin?: string | null;
    } = {},
  ) {
    const part = body(
      options.fileName ?? "Client form_Leads_2026-09-12_2026-10-24.csv",
      options.type === undefined ? "text/csv" : options.type,
      bytes,
    );
    const origin = options.origin === undefined ? publicOrigin : options.origin;
    return fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/imports?company=${slug}`,
      payload: Buffer.concat([part.head, part.bytes, part.tail]),
      headers: {
        "content-type": `multipart/form-data; boundary=${part.boundary}`,
        ...(origin ? { origin } : {}),
        ...(cookie ? { cookie } : {}),
      },
    });
  }
  const reopen = (slug: string, cookie: string, batchId: string) =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/imports/getUploadResult?batchId=${batchId}`,
      headers: { cookie },
    });
  const enter = (cookie: string, companyId: string) =>
    fixture.companyRequest("POST", "enterCompany", cookie, {
      companyId,
      reason: "Uploading the client lead export",
    });
  async function storedFiles() {
    const found: string[] = [];
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else found.push(path.slice(fixture.uploadsRoot.length + 1));
      }
    }
    await walk(fixture.uploadsRoot);
    return found.sort();
  }
  const counts = async (target: { agencyId: string; companyId: string }) => {
    const [jobs] = await fixture.rows<{ count: number }>(
      sql`select count(*)::int as count from pgboss.job where name like 'import%'`,
    );
    return fixture.scoped(target, async (tx) => ({
      batches: (await tx.select().from(importBatches)).length,
      rows: (await tx.select().from(importRows)).length,
      jobs: jobs.count,
    }));
  };
  async function setup() {
    const base = await fixture.setup();
    expect((await enter(base.a.cookie, base.a.companyId)).statusCode).toBe(200);
    return base;
  }
  const csv = (text: string) => Buffer.from(text);

  it("stores the Meta file and its batch, and reopens the same result", async () => {
    const { a, slug } = await setup();
    const before = await storedFiles();
    const bytes = await readFile(meta);
    const response = await upload(slug, a.cookie, bytes);
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data).toMatchObject({
      encoding: "utf-16le",
      delimiter: "\t",
      rowCount: 4,
      warnings: [],
      dateRange: {
        from: "2026-09-12T04:26:12.000Z",
        to: "2026-10-24T02:30:00.000Z",
      },
      newColumns: [],
      missingColumns: [],
    });
    expect(data.headers).toHaveLength(17);
    expect(data.suggestedMapping).toEqual(
      expect.arrayContaining([
        { header: "phone", target: "system:phone" },
        { header: "created_time", target: "system:lead_date" },
        { header: "platform", target: "system:source" },
        { header: "ad_id", target: "skip" },
      ]),
    );
    const placed = `imports/${a.companyId}/${data.batchId}.csv`;
    expect(await storedFiles()).toEqual([...before, placed].sort());
    expect(await readFile(join(fixture.uploadsRoot, placed))).toEqual(bytes);
    expect(await fixture.audits("imports.uploaded")).toEqual([
      { target_id: data.batchId },
    ]);
    const [audit] = await fixture.rows<{ data: unknown }>(
      sql`select data from audit_log where action = 'imports.uploaded'`,
    );
    expect(audit.data).toEqual({ batchId: data.batchId, rowCount: "4" });
    const [batch] = await fixture.scoped(a, (tx) =>
      tx.select().from(importBatches),
    );
    expect(batch).toMatchObject({
      status: "uploaded",
      fileSize: bytes.length,
      filePath: placed,
      uploadedBy: a.user.id,
    });
    expect(await counts(a)).toEqual({ batches: 1, rows: 0, jobs: 0 });
    const again = await reopen(slug, a.cookie, data.batchId);
    expect(again.statusCode).toBe(200);
    expect(again.json().data).toEqual(data);
  });

  it("does not reopen another company's batch or a missing one", async () => {
    const { a, b, slug } = await setup();
    const { batchId } = (
      await upload(slug, a.cookie, await readFile(meta))
    ).json().data;
    expect((await enter(b.cookie, b.companyId)).statusCode).toBe(200);
    expect((await reopen(b.company.slug, b.cookie, batchId)).statusCode).toBe(
      404,
    );
    expect((await reopen(slug, a.cookie, v7())).statusCode).toBe(404);
    expect((await reopen(slug, a.cookie, "not-a-uuid")).statusCode).toBe(400);
  });

  it("takes a file of exactly 25 MB and refuses one byte more", async () => {
    const { a, slug } = await setup();
    const cap = 25 * 1024 * 1024;
    const head = "name,notes\n";
    const line = `Test Lead,${"x".repeat(1013)}\n`;
    const lines = Math.floor((cap - head.length) / line.length);
    const rest = cap - head.length - lines * line.length;
    const exact = Buffer.from(
      `${head + line.repeat(lines)}Test Lead,${"y".repeat(rest - 11)}\n`,
    );
    expect(exact.length).toBe(cap);
    const ok = await upload(slug, a.cookie, exact);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.rowCount).toBe(lines + 1);
    const before = await storedFiles();
    const over = await upload(slug, a.cookie, Buffer.concat([exact, csv("z")]));
    expect(over.statusCode).toBe(400);
    expect(over.json().error).toBe("validation");
    expect(await storedFiles()).toEqual(before);
    expect((await counts(a)).batches).toBe(1);
  });

  it.each<[string, { fileName?: string; type?: string | null }, Uint8Array]>([
    ["a spreadsheet name", { fileName: "leads.xlsx" }, csv("a,b\n1,2\n")],
    ["an image type", { type: "image/png" }, csv("a,b\n1,2\n")],
    [
      "binary bytes with no type",
      { type: null },
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
    ],
    ["an empty file", {}, csv("")],
    ["a header with no rows", {}, csv("name,phone\n")],
  ])("refuses %s and keeps nothing", async (_, options, bytes) => {
    const { a, slug } = await setup();
    const before = await storedFiles();
    const response = await upload(slug, a.cookie, bytes, options);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("validation");
    expect(await storedFiles()).toEqual(before);
    expect(await counts(a)).toEqual({ batches: 0, rows: 0, jobs: 0 });
  });

  it("takes a text file the browser sent with no type", async () => {
    const { a, slug } = await setup();
    const response = await upload(
      slug,
      a.cookie,
      csv("name;phone\nTest;9841000001\n"),
      {
        fileName: "leads.txt",
        type: "application/octet-stream",
      },
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().data.delimiter).toBe(";");
  });

  it("refuses people who may not upload before any file is written", async () => {
    const { a, b, slug, manager, seller, owner } = await setup();
    const before = await storedFiles();
    const bytes = await readFile(meta);
    for (const [cookie, status] of [
      [seller.cookie, 403],
      [manager.cookie, 403],
      [b.cookie, 404],
      [owner.cookie, 403],
      [null, 401],
    ] as const)
      expect((await upload(slug, cookie, bytes)).statusCode).toBe(status);
    for (const origin of [null, "https://evil.example"])
      expect((await upload(slug, a.cookie, bytes, { origin })).statusCode).toBe(
        403,
      );
    fixture.advance(8 * 60 * minute);
    expect((await upload(slug, a.cookie, bytes)).statusCode).toBe(403);
    expect(await storedFiles()).toEqual(before);
    expect(await counts(a)).toEqual({ batches: 0, rows: 0, jobs: 0 });
  });

  it("lets a manager upload only when the company allows it", async () => {
    const { a, slug, manager } = await setup();
    await fixture.db.transaction(async (tx) => {
      await tx.execute(sql`select
        set_config('app.scope_kind', 'company', true),
        set_config('app.agency_id', ${a.agencyId}, true),
        set_config('app.company_id', ${a.companyId}, true),
        set_config('app.user_id', ${a.user.id}, true)`);
      await tx.execute(
        sql`update companies set settings = '{"super_admin_can_import": true}' where id = ${a.companyId}`,
      );
    });
    const response = await upload(slug, manager.cookie, await readFile(meta));
    expect(response.statusCode).toBe(200);
  });

  it("refuses the 21st upload in an hour with 429", async () => {
    const { a, slug } = await setup();
    const bytes = csv("name,phone\nTest,9841000001\n");
    for (let i = 0; i < 20; i++)
      expect((await upload(slug, a.cookie, bytes)).statusCode).toBe(200);
    const before = await storedFiles();
    const refused = await upload(slug, a.cookie, bytes);
    expect(refused.statusCode).toBe(429);
    expect(refused.headers["retry-after"]).toBeDefined();
    expect(refused.json()).toMatchObject({ ok: false, error: "validation" });
    expect(await storedFiles()).toEqual(before);
    fixture.advance(61 * minute);
    expect((await upload(slug, a.cookie, bytes)).statusCode).toBe(200);
  });

  it("refuses to record the batch when the entry ends during the upload", async () => {
    const { a, slug } = await setup();
    const before = await storedFiles();
    const part = body(
      "leads.csv",
      "text/csv",
      csv("name,phone\nTest,9841000001\n"),
    );
    const stream = new PassThrough();
    const pending = fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/imports?company=${slug}`,
      payload: stream,
      headers: {
        "content-type": `multipart/form-data; boundary=${part.boundary}`,
        origin: publicOrigin,
        cookie: a.cookie,
      },
    });
    stream.write(part.head);
    await sleep(300);
    fixture.advance(8 * 60 * minute);
    stream.end(Buffer.concat([Buffer.from(part.bytes), part.tail]));
    expect((await pending).statusCode).toBe(403);
    expect(await storedFiles()).toEqual(before);
    expect((await counts(a)).batches).toBe(0);
  });

  it("removes the stored file when the batch insert fails", async () => {
    const { a, slug } = await setup();
    const before = await storedFiles();
    await fixture.owner(
      "ALTER TABLE public.import_batches ADD CONSTRAINT proof_block CHECK (file_size < 0) NOT VALID",
    );
    try {
      const response = await upload(slug, a.cookie, await readFile(meta));
      expect(response.statusCode).toBeGreaterThanOrEqual(500);
    } finally {
      await fixture.owner(
        "ALTER TABLE public.import_batches DROP CONSTRAINT proof_block",
      );
    }
    expect(await storedFiles()).toEqual(before);
    expect(await fixture.audits("imports.uploaded")).toEqual([]);
  });

  it("refuses a lead that points at another company's batch", async () => {
    const { a, b, slug } = await setup();
    const { batchId } = (
      await upload(slug, a.cookie, await readFile(meta))
    ).json().data;
    const [stage] = await fixture.scoped(b, (tx) =>
      tx.select().from(stages).limit(1),
    );
    await expect(
      fixture.addLead(b, stage.id, { importBatchId: batchId }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    const [own] = await fixture.scoped(a, (tx) =>
      tx.select().from(stages).limit(1),
    );
    await fixture.addLead(a, own.id, { importBatchId: batchId });
    const kept = await fixture.scoped(a, (tx) => tx.select().from(leads));
    expect(kept.map((lead) => lead.importBatchId)).toEqual([batchId]);
  });
});
