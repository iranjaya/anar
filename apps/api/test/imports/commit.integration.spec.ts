import {
  fields,
  importBatches,
  importRuns,
  mappingTemplates,
} from "@anar/db/tenant";
import { inArray, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import commitSnapshot from "../../src/modules/imports/commitSnapshot.js";
import { loadSchema } from "../../src/modules/settings/index.js";
import { publicOrigin } from "../auth/fixture.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";
import { company } from "./runFixture.js";

type Target = { agencyId: string; companyId: string };
const header = "full_name,phone,created_time,campaign_name,budget,unit";
const at = "2026-09-12T10:11:12+05:45";
const phone = (n: number) => `+97798410${String(n).padStart(5, "0")}`;
const file = Buffer.from(
  [
    header,
    `Asha,${phone(1)},${at},Spring,1500,2_bhk`,
    `Bina,${phone(2)},${at},Spring,,3_bhk`,
  ].join("\n"),
);
const skipped = [
  { header: "full_name", target: "system:full_name" },
  { header: "phone", target: "system:phone" },
  { header: "created_time", target: "system:lead_date" },
  { header: "campaign_name", target: "system:campaign_name" },
  { header: "budget", target: "skip" },
  { header: "unit", target: "skip" },
];
const withFields = {
  mapping: [
    ...skipped.slice(0, 4),
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
};

describe("commit starts the import that was checked, once", () => {
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
  async function enter(target: Target & { companyId: string }, cookie: string) {
    const response = await fixture.companyRequest(
      "POST",
      "enterCompany",
      cookie,
      { companyId: target.companyId, reason: "Importing the client export" },
    );
    expect(response.statusCode).toBe(200);
  }
  async function upload(slug: string, cookie: string) {
    const boundary = `anar-${v7()}`;
    const response = await fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/imports?company=${slug}`,
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="leads.csv"\r\nContent-Type: text/csv\r\n\r\n`,
        ),
        file,
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
  async function setup(
    choices: {
      mapping: { header: string; target: string }[];
      newFields: object[];
      saveTemplate?: { name: string };
    } = { mapping: skipped, newFields: [] },
  ) {
    const base = await fixture.setup();
    await enter(base.a, base.a.cookie);
    const batchId = await upload(base.slug, base.a.cookie);
    const draft = { batchId, ...choices, expectedRevision: 0 };
    const checked = await call(base.slug, base.a.cookie, "dryRunImport", draft);
    expect(checked.statusCode).toBe(200);
    const previewRevision = checked.json().data.previewRevision as number;
    const commit = {
      ...draft,
      expectedRevision: previewRevision,
      previewRevision,
    };
    const send = (body: object = commit, cookie = base.a.cookie) =>
      call(base.slug, cookie, "commitImport", body);
    return { ...base, batchId, commit, send };
  }
  const saved = (target: Target) =>
    fixture.scoped(target, async (tx) => ({
      batch: (await tx.select().from(importBatches))[0],
      runs: await tx.select().from(importRuns),
      fieldKeys: (
        await tx
          .select({ key: fields.key })
          .from(fields)
          .where(inArray(fields.key, ["budget", "unit"]))
      ).map((row) => row.key),
      templates: await tx.select().from(mappingTemplates),
    }));
  const jobs = () =>
    fixture.rows<{ id: string; data: object }>(
      sql`select id, data from pgboss.job where name = 'import.commit'`,
    );
  const committedAudits = () =>
    fixture.rows<{ target_id: string }>(
      sql`select target_id from audit_log where action = 'imports.committed'`,
    );

  it("starts one run and job, and a second click gets the same job", async () => {
    const { a, batchId, send } = await setup();
    const first = await send();
    expect(first.statusCode).toBe(200);
    const { jobId } = first.json().data;
    expect(jobId).not.toBe(batchId);
    const again = await send();
    expect(again.json().data).toEqual({ jobId });
    const { batch, runs } = await saved(a);
    expect(batch).toMatchObject({ status: "mapped", activeRunId: runs[0].id });
    expect(runs).toEqual([
      expect.objectContaining({
        runNo: 1,
        actorUserId: a.user.id,
        role: "agency_staff",
        state: "queued",
        jobId,
        mappingRevision: batch.previewRevision,
      }),
    ]);
    expect(await jobs()).toEqual([
      {
        id: jobId,
        data: {
          agencyId: a.agencyId,
          companyId: a.companyId,
          actorUserId: a.user.id,
          batchId,
          runId: runs[0].id,
        },
      },
    ]);
    expect(await committedAudits()).toEqual([{ target_id: batchId }]);
  });

  it("refuses other choices than the checked ones, before and after commit", async () => {
    const { a, commit, send } = await setup();
    const changed = {
      ...commit,
      mapping: commit.mapping.map((row) =>
        row.header === "full_name" ? { ...row, target: "skip" } : row,
      ),
    };
    expect((await send(changed)).statusCode).toBe(409);
    expect(
      (
        await send({
          ...commit,
          previewRevision: commit.previewRevision + 1,
          expectedRevision: commit.previewRevision + 1,
        })
      ).statusCode,
    ).toBe(409);
    expect((await saved(a)).runs).toEqual([]);
    expect((await send()).statusCode).toBe(200);
    expect((await send(changed)).statusCode).toBe(409);
    expect((await saved(a)).runs).toHaveLength(1);
  });

  it("asks for a new check when company fields changed after it", async () => {
    const { a, slug, manager, send } = await setup();
    expect(
      (
        await fixture.post(slug, manager.cookie, "createField", {
          label: "Notes",
          type: "text",
        })
      ).statusCode,
    ).toBe(200);
    expect((await send()).statusCode).toBe(409);
    expect((await saved(a)).runs).toEqual([]);
  });

  it("needs no fresh code when the import changes no settings", async () => {
    const { send } = await setup();
    fixture.advance(15 * 60_000 + 1);
    expect((await send()).statusCode).toBe(200);
  });

  it("adds new fields and answers only with a fresh code, then freezes the schema after them", async () => {
    const { a, send, commit } = await setup({
      ...withFields,
      saveTemplate: { name: "Meta export" },
    });
    fixture.advance(15 * 60_000 + 1);
    const stale = await send();
    expect(stale.statusCode).toBe(428);
    expect(await saved(a)).toMatchObject({
      fieldKeys: [],
      runs: [],
      templates: [],
      batch: { status: "uploaded" },
    });
    const fresh = await fixture.loginAs(a.user);
    await enter(a, fresh.cookie);
    expect((await send(commit, fresh.cookie)).statusCode).toBe(200);
    const after = await saved(a);
    expect(after.fieldKeys.sort()).toEqual(["budget", "unit"]);
    expect(after.templates).toEqual([
      expect.objectContaining({ name: "Meta export" }),
    ]);
    const schema = await fixture.scoped(a, (tx) => loadSchema(tx));
    expect(
      schema.fields.find((field) => field.key === "unit")?.options,
    ).toEqual([
      { value: "2_bhk", label: "2 BHK" },
      { value: "3_bhk", label: "3 bhk" },
    ]);
    expect(after.batch.frozen).toMatchObject({
      schemaFingerprint: commitSnapshot.schemaFingerprint(
        schema.fields,
        company,
      ),
      newOptionsAdded: 1,
      mapping: commit.mapping,
    });
  });

  it("refuses a new field key that an archived field still holds", async () => {
    const base = await fixture.setup();
    const created = await fixture.post(
      base.slug,
      base.manager.cookie,
      "createField",
      {
        key: "budget",
        label: "Old budget",
        type: "text",
      },
    );
    await fixture.post(base.slug, base.manager.cookie, "archiveField", {
      fieldId: created.json().data.fieldId,
    });
    await enter(base.a, base.a.cookie);
    const batchId = await upload(base.slug, base.a.cookie);
    const draft = { batchId, ...withFields, expectedRevision: 0 };
    const checked = await call(base.slug, base.a.cookie, "dryRunImport", draft);
    const previewRevision = checked.json().data.previewRevision;
    const response = await call(base.slug, base.a.cookie, "commitImport", {
      ...draft,
      expectedRevision: previewRevision,
      previewRevision,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("archived field");
    expect((await saved(base.a)).runs).toEqual([]);
  });

  const queueDown = [
    `CREATE FUNCTION public.test_queue_down() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'queue down'; END $$;
     CREATE TRIGGER test_queue_down BEFORE INSERT ON pgboss.job FOR EACH ROW EXECUTE FUNCTION public.test_queue_down();`,
    `DROP TRIGGER test_queue_down ON pgboss.job; DROP FUNCTION public.test_queue_down();`,
  ];
  const revoke = (grant: string) => [
    `REVOKE ${grant} FROM anar_app`,
    `GRANT ${grant} TO anar_app`,
  ];
  for (const [what, [breakIt, fixIt]] of [
    ["the job cannot be queued", queueDown],
    ["the audit cannot be written", revoke("INSERT ON audit_log")],
    ["the template cannot be saved", revoke("INSERT ON mapping_templates")],
  ] as const)
    it(`keeps nothing when ${what}`, async () => {
      const { a, send } = await setup({
        ...withFields,
        saveTemplate: { name: "Meta export" },
      });
      await fixture.owner(breakIt);
      try {
        expect((await send()).statusCode).toBe(500);
      } finally {
        await fixture.owner(fixIt);
      }
      expect(await saved(a)).toMatchObject({
        fieldKeys: [],
        runs: [],
        templates: [],
        batch: { status: "uploaded", frozen: null, activeRunId: null },
      });
      expect(await jobs()).toEqual([]);
    });

  it("refuses an Admin and a company the person did not enter", async () => {
    const { seller, foreignSlug, commit, send } = await setup();
    expect((await send(commit, seller.cookie)).statusCode).toBe(403);
    const foreign = await call(
      foreignSlug,
      seller.cookie,
      "commitImport",
      commit,
    );
    expect([403, 404]).toContain(foreign.statusCode);
  });
});
