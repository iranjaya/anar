import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  fields,
  importBatches,
  importRows,
  leadEvents,
  leads,
  notifications,
  stages,
} from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { publicOrigin } from "../auth/fixture.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

type Target = { agencyId: string; companyId: string };
const header = "full_name\tphone\tcreated_time\tcampaign_name\tbudget\tunit";
const at = "2026-09-12T10:11:12+05:45";
const utf16 = (lines: string[]) =>
  Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(`${[header, ...lines].join("\r\n")}\r\n`, "utf16le"),
  ]);
const phone = (n: number) => `+97798410${String(n).padStart(5, "0")}`;

describe("preview checks the whole file and saves only a fresh result", () => {
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

  async function upload(slug: string, cookie: string, bytes: Buffer) {
    const boundary = `anar-${v7()}`;
    const response = await fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/imports?company=${slug}`,
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="leads.csv"\r\nContent-Type: text/csv\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        origin: publicOrigin,
        cookie,
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().data.batchId as string;
  }
  const call = (
    slug: string,
    cookie: string,
    operation: string,
    payload: object,
  ) =>
    fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${slug}/imports/${operation}`,
      payload,
      headers: { origin: publicOrigin, cookie },
    });
  const readDraft = (slug: string, cookie: string, batchId: string) =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/imports/getImportDraft?batchId=${batchId}`,
      headers: { cookie },
    });
  const draftFor = (batchId: string, expectedRevision = 0) => ({
    batchId,
    mapping: [
      { header: "full_name", target: "system:full_name" },
      { header: "phone", target: "system:phone" },
      { header: "created_time", target: "system:lead_date" },
      { header: "campaign_name", target: "system:campaign_name" },
      { header: "budget", target: "field:budget" },
      { header: "unit", target: "field:unit" },
    ],
    newFields: [
      { header: "budget", key: "budget", label: "Budget", type: "number" },
      {
        header: "unit",
        key: "unit",
        label: "Unit",
        type: "dropdown",
        options: [{ value: "2_bhk", label: "2 BHK" }],
      },
    ],
    expectedRevision,
  });
  async function setup(lines: string[] | Buffer) {
    const base = await fixture.setup();
    expect(
      (
        await fixture.companyRequest("POST", "enterCompany", base.a.cookie, {
          companyId: base.a.companyId,
          reason: "Checking the client lead export",
        })
      ).statusCode,
    ).toBe(200);
    const [stage] = await fixture.scoped(base.a, (tx) =>
      tx.select().from(stages).limit(1),
    );
    const bytes = Buffer.isBuffer(lines) ? lines : utf16(lines);
    const batchId = await upload(base.slug, base.a.cookie, bytes);
    return { ...base, stageId: stage.id, batchId };
  }
  const untouched = async (target: Target) => {
    const [jobs] = await fixture.rows<{ count: number }>(
      sql`select count(*)::int as count from pgboss.job where name like 'import%'`,
    );
    return fixture.scoped(target, async (tx) => ({
      leads: (await tx.select().from(leads)).length,
      events: (await tx.select().from(leadEvents)).length,
      rows: (await tx.select().from(importRows)).length,
      notifications: (await tx.select().from(notifications)).length,
      fields: (await tx.select().from(fields)).length,
      jobs: jobs.count,
    }));
  };
  const savedPreview = async (target: Target) => {
    const [batch] = await fixture.scoped(target, (tx) =>
      tx.select().from(importBatches),
    );
    return {
      revision: batch.previewRevision,
      preview: (batch.draft as { preview: unknown } | null)?.preview ?? null,
    };
  };
  const small = [`Asha\t${phone(1)}\t${at}\tSpring\t\t2_bhk`];
  // Swaps the stored file for a pipe, so the check waits on the read until the test closes it.
  async function pauseRead(target: Target, batchId: string) {
    const path = join(
      fixture.uploadsRoot,
      "imports",
      target.companyId,
      `${batchId}.csv`,
    );
    await rm(path);
    await promisify(execFile)("mkfifo", [path]);
    return {
      async reading() {
        const writer = await open(path, "w");
        await writer.write(utf16(small));
        return { finish: () => writer.close() };
      },
      async restore() {
        await rm(path);
        await writeFile(path, utf16(small));
      },
    };
  }
  it("classifies the encoded file against fixture leads and saves exact totals", async () => {
    const { a, slug, stageId, batchId } = await setup([
      `Asha\t${phone(1)}\t${at}\tSpring\t1500\t2_bhk`,
      `\t${phone(2)}\t${at}\tAutumn\t\t2_bhk`,
      `Bina\t${phone(3)}\t${at}\tSpring\t\t3_bhk`,
      `Bina again\t${phone(3)}\t${at}\tSpring\t\t2_bhk`,
      `Bina once more\t${phone(3)}\t${at}\tSpring\t\t2_bhk`,
      `Asha copy\t${phone(1)}\t${at}\tSpring\t\t2_bhk`,
      `Bad phone\tp:12345\t${at}\tSpring\t\t2_bhk`,
      `Too wide\t${phone(8)}\t${at}\tSpring\t\t2_bhk\textra`,
      `Odd budget\t${phone(9)}\t${at}\tSpring\tlots\t2_bhk`,
    ]);
    await fixture.addLead(a, stageId, {
      phoneE164: phone(1),
      phoneValid: true,
      campaignName: "Spring",
      leadDate: new Date("2026-09-12T04:26:12.000Z"),
    });
    await fixture.addLead(a, stageId, {
      phoneE164: phone(2),
      phoneValid: true,
      campaignName: "Spring",
      leadDate: new Date("2026-09-12T04:26:12.000Z"),
    });
    const before = await untouched(a);
    const response = await call(
      slug,
      a.cookie,
      "dryRunImport",
      draftFor(batchId),
    );
    expect(response.statusCode).toBe(200);
    const result = response.json().data;
    expect(result).toMatchObject({
      toAdd: 3,
      needPhoneReview: 1,
      sameSubmission: 1,
      counts: { rowCount: 9, resubmitted: 1, duplicateFile: 3, invalid: 1 },
      previewRevision: 1,
      newOptions: [
        { fieldKey: "unit", option: { value: "3_bhk", label: "3 bhk" } },
      ],
    });
    expect(result.resubmitted).toEqual([
      expect.objectContaining({
        id: `${batchId}:2`,
        reason: "resubmitted",
        display: { fullName: null, phoneRaw: phone(2) },
      }),
    ]);
    expect(
      result.duplicateFile.map((row: { rowNo: number }) => row.rowNo),
    ).toEqual([4, 5, 6]);
    expect(
      result.invalidRows.map((row: { rowNo: number }) => row.rowNo),
    ).toEqual([8]);
    expect(await savedPreview(a)).toEqual({ revision: 1, preview: result });
    expect(
      (await readDraft(slug, a.cookie, batchId)).json().data.preview,
    ).toEqual(result);
    expect(await untouched(a)).toEqual(before);
  });

  it("keeps the first 50 exceptions but counts all of them", async () => {
    const { a, slug, batchId } = await setup(
      Array.from(
        { length: 120 },
        (_, n) => `Lead ${n}\tp:1${n}\t${at}\tSpring\t\t2_bhk`,
      ),
    );
    const result = (
      await call(slug, a.cookie, "dryRunImport", draftFor(batchId))
    ).json().data;
    expect(result).toMatchObject({
      toAdd: 120,
      needPhoneReview: 120,
      counts: { rowCount: 120 },
    });
    expect(result.phoneReview).toHaveLength(50);
  });

  it("lists every new answer and saves a commit snapshot the browser never sees", async () => {
    const lines = Array.from(
      { length: 120 },
      (_, n) => `Lead ${n}\t${phone(n)}\t${at}\tSpring\t\tunit_${n}`,
    );
    const { a, slug, batchId } = await setup(lines);
    const result = (
      await call(slug, a.cookie, "dryRunImport", draftFor(batchId))
    ).json().data;
    expect(result.newOptions).toHaveLength(120);
    expect(result.newOptions[119]).toEqual({
      fieldKey: "unit",
      option: { value: "unit_119", label: "Unit 119" },
    });
    const [batch] = await fixture.scoped(a, (tx) =>
      tx.select().from(importBatches),
    );
    const snapshot = (batch.draft as { snapshot: Record<string, string> })
      .snapshot;
    expect(snapshot.fileSha256).toBe(
      createHash("sha256").update(utf16(lines)).digest("hex"),
    );
    expect(snapshot).toEqual({
      fileSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      schemaFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      commitHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const draft = (await readDraft(slug, a.cookie, batchId)).json().data;
    expect(draft).not.toHaveProperty("snapshot");
    expect(draft.preview).toEqual(result);
  });

  it("refuses an old draft revision without starting", async () => {
    const { a, slug, batchId } = await setup([
      `Asha\t${phone(1)}\t${at}\tSpring\t\t2_bhk`,
    ]);
    expect(
      (await call(slug, a.cookie, "saveImportDraft", draftFor(batchId)))
        .statusCode,
    ).toBe(200);
    const stale = await call(slug, a.cookie, "dryRunImport", draftFor(batchId));
    expect(stale.statusCode).toBe(409);
    expect(await savedPreview(a)).toEqual({ revision: 1, preview: null });
  });

  it("refuses to save the result when a company field changes during the check", async () => {
    const { a, slug, batchId } = await setup(small);
    const pipe = await pauseRead(a, batchId);
    const pending = call(slug, a.cookie, "dryRunImport", draftFor(batchId));
    const read = await pipe.reading();
    await fixture.scoped(a, (tx) =>
      tx
        .update(fields)
        .set({ options: [{ value: "yes", label: "Yes" }] })
        .where(eq(fields.key, "budget_fit")),
    );
    await read.finish();
    const response = await pending;
    expect(response.statusCode).toBe(409);
    expect(await savedPreview(a)).toEqual({ revision: 1, preview: null });
  });

  it("refuses to save the result when the columns are saved again during the check", async () => {
    const { a, slug, batchId } = await setup(small);
    const pipe = await pauseRead(a, batchId);
    const pending = call(slug, a.cookie, "dryRunImport", draftFor(batchId));
    const read = await pipe.reading();
    expect(
      (await call(slug, a.cookie, "saveImportDraft", draftFor(batchId, 1)))
        .statusCode,
    ).toBe(200);
    await read.finish();
    expect((await pending).statusCode).toBe(409);
    await pipe.restore();
    const saved = await savedPreview(a);
    expect(saved).toEqual({ revision: 2, preview: null });
    const again = await call(
      slug,
      a.cookie,
      "dryRunImport",
      draftFor(batchId, 2),
    );
    expect(again.json().data.previewRevision).toBe(3);
  });

  it("holds no lock while reading, and stops when the person signs out mid check", async () => {
    const { a, slug, batchId } = await setup(small);
    const pipe = await pauseRead(a, batchId);
    let done = false;
    const pending = call(
      slug,
      a.cookie,
      "dryRunImport",
      draftFor(batchId),
    ).finally(() => {
      done = true;
    });
    const read = await pipe.reading();
    const reopen = () =>
      fixture.apps[0].app.inject({
        method: "GET",
        url: `/api/companies/${slug}/imports/getUploadResult?batchId=${batchId}`,
        headers: { cookie: a.cookie },
      });
    expect((await reopen()).statusCode).toBe(200);
    const logout = await fixture.apps[0].app.inject({
      method: "POST",
      url: "/api/auth/logout",
      payload: {},
      headers: { origin: publicOrigin, cookie: a.cookie },
    });
    expect(logout.statusCode).toBe(200);
    expect((await reopen()).statusCode).toBe(401);
    expect(done).toBe(false);
    await read.finish();
    expect((await pending).statusCode).toBe(401);
    expect(await savedPreview(a)).toEqual({ revision: 1, preview: null });
  });

  it("saves nothing when the lead lookup fails", async () => {
    const { a, slug, batchId } = await setup([
      `Asha\t${phone(1)}\t${at}\tSpring\t\t2_bhk`,
    ]);
    await fixture.owner("REVOKE SELECT ON public.leads FROM anar_app");
    try {
      const response = await call(
        slug,
        a.cookie,
        "dryRunImport",
        draftFor(batchId),
      );
      expect(response.statusCode).toBeGreaterThanOrEqual(500);
    } finally {
      await fixture.owner("GRANT SELECT ON public.leads TO anar_app");
    }
    expect(await savedPreview(a)).toEqual({ revision: 1, preview: null });
  });

  it("refuses people who may not import and requests from another site", async () => {
    const { a, slug, batchId, seller } = await setup([
      `Asha\t${phone(1)}\t${at}\tSpring\t\t2_bhk`,
    ]);
    expect(
      (await call(slug, seller.cookie, "dryRunImport", draftFor(batchId)))
        .statusCode,
    ).toBe(403);
    const hostile = await fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${slug}/imports/dryRunImport`,
      payload: draftFor(batchId),
      headers: { origin: "https://evil.example", cookie: a.cookie },
    });
    expect(hostile.statusCode).toBe(403);
    expect(await savedPreview(a)).toEqual({ revision: 0, preview: null });
  });

  it("checks a valid 25 MB file inside the deadline", async () => {
    const base = await fixture.setup();
    await fixture.companyRequest("POST", "enterCompany", base.a.cookie, {
      companyId: base.a.companyId,
      reason: "Checking the client lead export",
    });
    const line = (n: number) =>
      `Lead ${n},${phone(n % 99_999)},2026-09-12T10:11:12+05:45,Spring,${n},2_bhk\n`;
    let text = "full_name,phone,created_time,campaign_name,budget,unit\n";
    for (let n = 0; text.length < 25 * 1024 * 1024 - 200; n++) text += line(n);
    const batchId = await upload(base.slug, base.a.cookie, Buffer.from(text));
    const started = Date.now();
    const response = await call(
      base.slug,
      base.a.cookie,
      "dryRunImport",
      draftFor(batchId),
    );
    expect(response.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(120_000);
    const { counts } = response.json().data;
    expect(counts.rowCount).toBeGreaterThan(300_000);
  }, 150_000);
});
