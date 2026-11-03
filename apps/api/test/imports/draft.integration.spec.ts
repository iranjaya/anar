import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fields,
  importBatches,
  importRows,
  leadEvents,
  leads,
  mappingTemplates,
} from "@anar/db/tenant";
import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { publicOrigin } from "../auth/fixture.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

type Row = { header: string; target: string };
type NewField = {
  header: string;
  key: string;
  label: string;
  type: string;
  options?: { value: string; label: string }[];
};
const meta = join(import.meta.dirname, "../fixtures/csv/meta-utf16le-tab.csv");

describe("the column draft is saved on the batch and nowhere else", () => {
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

  async function upload(slug: string, cookie: string) {
    const boundary = `anar-${v7()}`;
    const response = await fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/imports?company=${slug}`,
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Spring_Leads_2026-09-12_2026-10-24.csv"\r\nContent-Type: text/csv\r\n\r\n`,
        ),
        await readFile(meta),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        origin: publicOrigin,
        cookie,
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().data as {
      batchId: string;
      suggestedMapping: Row[];
      proposedFields: NewField[];
    };
  }
  const save = (
    slug: string,
    cookie: string,
    body: object,
    origin: string | null = publicOrigin,
  ) =>
    fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${slug}/imports/saveImportDraft`,
      payload: body,
      headers: { cookie, ...(origin ? { origin } : {}) },
    });
  const read = (slug: string, cookie: string, batchId: string) =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/imports/getImportDraft?batchId=${batchId}`,
      headers: { cookie },
    });
  async function setup() {
    const base = await fixture.setup();
    expect(
      (
        await fixture.companyRequest("POST", "enterCompany", base.a.cookie, {
          companyId: base.a.companyId,
          reason: "Matching the client lead export",
        })
      ).statusCode,
    ).toBe(200);
    const uploaded = await upload(base.slug, base.a.cookie);
    const draft = {
      batchId: uploaded.batchId,
      mapping: uploaded.suggestedMapping,
      newFields: uploaded.proposedFields.map((field) =>
        field.key === "when_are_you_planning_to_purchase"
          ? {
              ...field,
              label: "Buying when",
              options: field.options?.map((option) => ({
                ...option,
                label: `${option.label} (edited)`,
              })),
            }
          : field,
      ),
      saveTemplate: { name: "Spring" },
      expectedRevision: 0,
    };
    return { ...base, ...uploaded, draft };
  }
  const writes = async (target: { agencyId: string; companyId: string }) => {
    const [jobs] = await fixture.rows<{ count: number }>(
      sql`select count(*)::int as count from pgboss.job where name like 'import%'`,
    );
    return fixture.scoped(target, async (tx) => ({
      fields: (await tx.select().from(fields)).length,
      templates: (await tx.select().from(mappingTemplates)).length,
      leads: (await tx.select().from(leads)).length,
      events: (await tx.select().from(leadEvents)).length,
      rows: (await tx.select().from(importRows)).length,
      jobs: jobs.count,
    }));
  };

  it("saves the draft with its labels, bumps the revision and reads it back", async () => {
    const { a, slug, draft, batchId } = await setup();
    const before = await writes(a);
    expect((await read(slug, a.cookie, batchId)).json().data).toBeNull();
    const saved = await save(slug, a.cookie, draft);
    expect(saved.statusCode).toBe(200);
    const { expectedRevision, ...kept } = draft;
    const expected = { ...kept, revision: 1, preview: null };
    expect(saved.json().data).toEqual(expected);
    expect((await read(slug, a.cookie, batchId)).json().data).toEqual(expected);
    const [batch] = await fixture.scoped(a, (tx) =>
      tx.select().from(importBatches),
    );
    expect(batch).toMatchObject({ status: "uploaded", previewRevision: 1 });
    expect(await writes(a)).toEqual(before);
  });

  it("refuses an old revision and lets only one of two edits win", async () => {
    const { a, slug, draft } = await setup();
    const results = await Promise.all([
      save(slug, a.cookie, draft),
      save(slug, a.cookie, { ...draft, saveTemplate: undefined }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const stale = await save(slug, a.cookie, draft);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("conflict");
    const next = await save(slug, a.cookie, { ...draft, expectedRevision: 1 });
    expect(next.json().data.revision).toBe(2);
  });

  const change = (
    draft: Awaited<ReturnType<typeof setup>>["draft"],
    edit: (mapping: Row[], newFields: NewField[]) => object,
  ) => ({
    ...draft,
    ...edit(structuredClone(draft.mapping), structuredClone(draft.newFields)),
  });
  it.each<[string, (m: Row[], f: NewField[]) => object, string]>([
    [
      "a column with no target",
      (m) => ({ mapping: m.slice(1) }),
      "Choose a target for every column",
    ],
    [
      "a second phone column",
      (m) => ({
        mapping: m.map((r) =>
          r.header === "email" ? { ...r, target: "system:phone" } : r,
        ),
      }),
      "Match exactly one column to Phone",
    ],
    [
      "two columns to one place",
      (m) => ({
        mapping: m.map((r) =>
          r.header === "email" ? { ...r, target: "system:full_name" } : r,
        ),
      }),
      "Columns full_name and email go to the same place",
    ],
    [
      "a field that is not active",
      (m) => ({
        mapping: m.map((r) =>
          r.header === "email" ? { ...r, target: "field:gone" } : r,
        ),
      }),
      "Column email goes to a field that is no longer active. Choose another target",
    ],
    [
      "a new field with a company field's key",
      (m, f) => ({
        mapping: m.map((r) =>
          r.header === "job_title" ? { ...r, target: "field:budget_fit" } : r,
        ),
        newFields: f.map((x) =>
          x.header === "job_title" ? { ...x, key: "budget_fit" } : x,
        ),
      }),
      "Each new field needs its own key",
    ],
    [
      "a dropdown with an empty answer label",
      (_, f) => ({
        newFields: f.map((x) =>
          x.type === "dropdown"
            ? { ...x, options: x.options?.map((o) => ({ ...o, label: " " })) }
            : x,
        ),
      }),
      "Give each new field a valid key, label and answer labels",
    ],
    [
      "a new field no column uses",
      (_, f) => ({
        newFields: [
          ...f,
          { header: "email", key: "spare", label: "Spare", type: "text" },
        ],
      }),
      "New field spare is not used by any column",
    ],
  ])("refuses %s with a clear message", async (_, edit, message) => {
    const { a, slug, draft } = await setup();
    const response = await save(slug, a.cookie, change(draft, edit));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "validation", message });
  });

  it("refuses a bad template name, a foreign batch and a batch that started", async () => {
    const { a, b, slug, draft, batchId } = await setup();
    expect(
      (
        await save(slug, a.cookie, {
          ...draft,
          saveTemplate: { name: "x".repeat(121) },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await save(slug, a.cookie, { ...draft, batchId: v7() })).statusCode,
    ).toBe(404);
    expect(
      (
        await fixture.companyRequest("POST", "enterCompany", b.cookie, {
          companyId: b.companyId,
          reason: "Matching the client lead export",
        })
      ).statusCode,
    ).toBe(200);
    expect((await save(b.company.slug, b.cookie, draft)).statusCode).toBe(404);
    await fixture.scoped(a, (tx) =>
      tx.update(importBatches).set({ status: "running" }),
    );
    const started = await save(slug, a.cookie, draft);
    expect(started.statusCode).toBe(409);
    expect((await read(slug, a.cookie, batchId)).json().data).toBeNull();
  });

  it("refuses people who may not import and requests from another site", async () => {
    const { a, slug, draft, seller, manager } = await setup();
    expect((await save(slug, seller.cookie, draft)).statusCode).toBe(403);
    expect((await save(slug, manager.cookie, draft)).statusCode).toBe(403);
    expect((await save(slug, a.cookie, draft, null)).statusCode).toBe(403);
    expect(
      (await save(slug, a.cookie, draft, "https://evil.example")).statusCode,
    ).toBe(403);
    expect((await read(slug, seller.cookie, draft.batchId)).statusCode).toBe(
      403,
    );
  });
});
