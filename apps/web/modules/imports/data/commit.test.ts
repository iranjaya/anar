import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { resetDemoStore, setDemoFailure, store } from "@/mock/access";
import { resolveContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import {
  commitImport,
  createImportBatch,
  dryRunImport,
  getImportBatch,
  getUploadResult,
  listImportRows,
} from "../server";
import { templateNameFromFile } from "../templates";
import type { Mapping } from "../types";

const now = new Date("2026-10-28T12:00:00+05:45");
const file = {
  fileName: "Sundar Heights 2 3 BHK October_Leads_2026-10-14_2026-10-28.csv",
  fileSize: 128,
};

describe("import commit", () => {
  let ctx: Ctx;
  let data: Awaited<ReturnType<typeof store>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    await resetDemoStore(now);
    ctx = await resolveContext(
      { userId: "rohan", actingCompanyId: "sundar-heights" },
      "sundar-heights",
    );
    data = await store();
  });
  afterEach(async () => {
    await setDemoFailure(false);
    vi.useRealTimers();
  });

  it("previews 371 same submissions, 3 resubmissions and 38 new leads without writing", async () => {
    const upload = await createImportBatch(ctx, file);
    const review = await dryRunImport(ctx, {
      batchId: upload.batchId,
      mapping: upload.suggestedMapping,
    });
    expect(review).toMatchObject({
      toAdd: 38,
      needPhoneReview: 2,
      sameSubmission: 371,
      duplicateFile: [],
    });
    expect(review.resubmitted).toHaveLength(3);
    expect(review.resubmitted.map((row) => row.leadId)).toEqual([
      "sundar-lead-001",
      "sundar-lead-002",
      "sundar-lead-003",
    ]);
    expect(review.phoneReview).toHaveLength(2);
    expect(review.phoneReview.map((row) => row.leadId)).toEqual([null, null]);
    expect(review.phoneReview.map((row) => row.raw.phone)).toEqual([
      "p:+97798123",
      "",
    ]);
    expect(data.leads).toHaveLength(420);
    expect(await listImportRows(ctx, { batchId: upload.batchId })).toEqual([]);
    expect((await getImportBatch(ctx, upload.batchId)).status).toBe("uploaded");
  });

  it("adds 38 unassigned leads and records every Sundar row", async () => {
    const upload = await createImportBatch(ctx, file);
    const eventsBefore = data.events.length;
    expect(
      await commitImport(ctx, {
        batchId: upload.batchId,
        mapping: upload.suggestedMapping,
      }),
    ).toEqual({ jobId: upload.batchId });
    const batch = await getImportBatch(ctx, upload.batchId);
    expect(batch).toMatchObject({
      status: "done",
      lastRowNo: 412,
      mapping: upload.suggestedMapping,
      summary: {
        imported: 38,
        needPhoneReview: 2,
        duplicateDb: 374,
        duplicateFile: 0,
        invalid: 0,
        error: 0,
        newOptions: 0,
      },
    });
    const leads = data.leads.filter(
      (lead) => lead.importBatchId === upload.batchId,
    );
    expect(data.leads).toHaveLength(458);
    expect(leads).toHaveLength(38);
    expect(
      leads.every(
        (lead) =>
          lead.companyId === "sundar-heights" &&
          lead.assignedTo === null &&
          lead.sourceKind === "import",
      ),
    ).toBe(true);
    expect(leads[0].custom).toMatchObject({
      apartment_type: "3_bhk",
      purchase_timeline: "within_1_month",
      purchase_purpose: "for_myself/family",
      job_title: "Engineer",
    });
    expect(leads.filter((lead) => !lead.phoneValid)).toHaveLength(2);
    expect(data.events.slice(eventsBefore)).toHaveLength(38);
    expect(
      data.events
        .slice(eventsBefore)
        .every(
          (event) => event.type === "imported" && event.actorUserId === "rohan",
        ),
    ).toBe(true);
    const rows = await listImportRows(ctx, { batchId: upload.batchId });
    expect(rows).toHaveLength(412);
    expect(new Set(rows.map((row) => row.rowNo)).size).toBe(412);
    expect(rows.filter((row) => row.reason === "same_submission")).toHaveLength(
      371,
    );
    expect(rows.filter((row) => row.reason === "resubmitted")).toHaveLength(3);
    expect(
      rows.every((row) => data.leads.some((lead) => lead.id === row.leadId)),
    ).toBe(true);
    const imported = await listImportRows(ctx, {
      batchId: upload.batchId,
      result: "imported",
    });
    expect(imported).toHaveLength(38);
    expect(
      imported
        .filter((row) => row.reason === "invalid_phone")
        .map((row) => row.raw.phone),
    ).toEqual(["p:+97798123", ""]);
  });

  it("commits the same batch once", async () => {
    const upload = await createImportBatch(ctx, file);
    const input = { batchId: upload.batchId, mapping: upload.suggestedMapping };
    const first = await commitImport(ctx, input);
    const saved = structuredClone(data);
    expect(await commitImport(ctx, input)).toEqual(first);
    expect(data).toEqual(saved);
  });

  it("adds nothing when the same fixture is uploaded again", async () => {
    const first = await createImportBatch(ctx, file);
    await commitImport(ctx, {
      batchId: first.batchId,
      mapping: first.suggestedMapping,
    });
    const eventsBefore = data.events.length;
    const second = await createImportBatch(ctx, file);
    expect(
      await dryRunImport(ctx, {
        batchId: second.batchId,
        mapping: second.suggestedMapping,
      }),
    ).toMatchObject({ toAdd: 0, needPhoneReview: 0, sameSubmission: 409 });
    await commitImport(ctx, {
      batchId: second.batchId,
      mapping: second.suggestedMapping,
    });
    expect(data.leads).toHaveLength(458);
    expect(data.events).toHaveLength(eventsBefore);
    expect((await getImportBatch(ctx, second.batchId)).summary).toMatchObject({
      imported: 0,
      needPhoneReview: 0,
      duplicateDb: 412,
    });
    expect(
      await listImportRows(ctx, {
        batchId: second.batchId,
        result: "imported",
      }),
    ).toEqual([]);
    expect(
      await listImportRows(ctx, { batchId: first.batchId, result: "imported" }),
    ).toHaveLength(38);
  });

  it("creates Pahad's four fields and saves their mapping and option labels", async () => {
    const pahad = await resolveContext(
      { userId: "rohan", actingCompanyId: "pahad-view" },
      "pahad-view",
    );
    const picked = {
      ...file,
      fileName:
        "Pahad View Apartments 2 3 BHK October_Leads_2026-10-14_2026-10-28.csv",
    };
    const upload = await createImportBatch(pahad, picked);
    const fields = structuredClone(upload.proposedFields);
    const apartment = fields[0];
    apartment.key = "apartment_choice";
    apartment.label = "Apartment choice";
    assert(apartment.options);
    apartment.options[2].label = "Three bedrooms";
    const mapping: Mapping = upload.suggestedMapping.map((row) =>
      row.header === apartment.header
        ? { ...row, target: "field:apartment_choice" }
        : row,
    );
    const sundar = structuredClone(data.leads);
    const input = {
      batchId: upload.batchId,
      mapping,
      newFields: fields,
      saveTemplate: { name: templateNameFromFile(picked.fileName) },
    };
    await commitImport(pahad, input);
    const created = data.fields.filter(
      (field) =>
        field.companyId === "pahad-view" &&
        fields.some((added) => added.key === field.key),
    );
    expect(created).toHaveLength(4);
    expect(created.map((field) => field.key)).toEqual(
      fields.map((field) => field.key),
    );
    expect(created[0]).toMatchObject({
      label: "Apartment choice",
      type: "dropdown",
      options: [
        { value: "1_bhk", label: "1 BHK" },
        { value: "2_bhk", label: "2 BHK" },
        { value: "3_bhk", label: "Three bedrooms" },
        { value: "not_sure_yet", label: "Not sure yet" },
      ],
    });
    expect(
      data.leads.filter((lead) => lead.companyId === "sundar-heights"),
    ).toEqual(sundar);
    const leads = data.leads.filter((lead) => lead.companyId === "pahad-view");
    expect(leads).toHaveLength(64);
    expect(leads[0].custom).toEqual({
      apartment_choice: "3_bhk",
      when_are_you_planning_to_purchase: "within_1_month",
      what_is_your_primary_purpose: "for_myself/family",
      job_title: "Engineer",
    });
    const batch = await getImportBatch(pahad, upload.batchId);
    expect(batch.summary).toMatchObject({
      imported: 64,
      needPhoneReview: 2,
      duplicateDb: 0,
    });
    expect(
      data.mappingTemplates.filter(
        (template) => template.companyId === "pahad-view",
      ),
    ).toEqual([
      expect.objectContaining({
        id: batch.mappingTemplateId,
        name: "Pahad View Apartments 2 3 BHK October",
        mapping,
        lastUsedAt: now,
      }),
    ]);
    const saved = structuredClone(data);
    await commitImport(pahad, input);
    expect(data).toEqual(saved);
    const next = await createImportBatch(pahad, picked);
    expect(await getUploadResult(pahad, next.batchId)).toMatchObject({
      matchedTemplate: {
        id: batch.mappingTemplateId,
        name: "Pahad View Apartments 2 3 BHK October",
      },
      suggestedMapping: mapping,
      proposedFields: [],
    });
  });

  it.each(["sunaina", "prakash"])(
    "refuses import reads and writes from %s even with a forged role",
    async (userId) => {
      const upload = await createImportBatch(ctx, file);
      const member = await resolveContext(
        { userId, actingCompanyId: null },
        "sundar-heights",
      );
      const forged: Ctx = {
        ...member,
        role: "dna",
        session: { id: "demo", actingCompanyId: "sundar-heights" },
      };
      const before = structuredClone(data);
      await expect(
        getImportBatch(forged, upload.batchId),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        listImportRows(forged, { batchId: upload.batchId }),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        dryRunImport(forged, {
          batchId: upload.batchId,
          mapping: upload.suggestedMapping,
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        commitImport(forged, {
          batchId: upload.batchId,
          mapping: upload.suggestedMapping,
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(data).toEqual(before);
    },
  );

  it("hides a foreign batch like a missing batch", async () => {
    const upload = await createImportBatch(ctx, file);
    const pahad = await resolveContext(
      { userId: "rohan", actingCompanyId: "pahad-view" },
      "pahad-view",
    );
    const before = structuredClone(data);
    for (const batchId of [upload.batchId, "missing-batch"]) {
      await expect(getImportBatch(pahad, batchId)).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(listImportRows(pahad, { batchId })).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(
        dryRunImport(pahad, { batchId, mapping: upload.suggestedMapping }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        commitImport(pahad, { batchId, mapping: upload.suggestedMapping }),
      ).rejects.toMatchObject({ code: "not_found" });
    }
    expect(data).toEqual(before);
  });

  it.each([
    "missing phone",
    "two phone columns",
    "duplicate header",
    "unknown field",
  ])("rejects a mapping with %s before writing", async (problem) => {
    const upload = await createImportBatch(ctx, file);
    const mapping = structuredClone(upload.suggestedMapping);
    const phone = mapping.find((row) => row.header === "phone");
    const email = mapping.find((row) => row.header === "email");
    assert(phone);
    assert(email);
    if (problem === "missing phone") phone.target = "skip";
    if (problem === "two phone columns") email.target = "system:phone";
    if (problem === "duplicate header") mapping[0].header = mapping[1].header;
    if (problem === "unknown field") mapping[0].target = "field:missing_field";
    const before = structuredClone(data);
    await expect(
      commitImport(ctx, { batchId: upload.batchId, mapping }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(data).toEqual(before);
  });

  it("keeps a failed field creation empty and accepts the corrected retry", async () => {
    const pahad = await resolveContext(
      { userId: "rohan", actingCompanyId: "pahad-view" },
      "pahad-view",
    );
    const upload = await createImportBatch(pahad, file);
    const fields = structuredClone(upload.proposedFields);
    assert(fields[0].options);
    fields[0].options.push({ ...fields[0].options[0] });
    const fieldsBefore = structuredClone(data.fields);
    await expect(
      commitImport(pahad, {
        batchId: upload.batchId,
        mapping: upload.suggestedMapping,
        newFields: fields,
      }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(data.fields).toEqual(fieldsBefore);
    expect(
      data.leads.filter((lead) => lead.companyId === "pahad-view"),
    ).toEqual([]);
    expect(await listImportRows(pahad, { batchId: upload.batchId })).toEqual(
      [],
    );
    await commitImport(pahad, {
      batchId: upload.batchId,
      mapping: upload.suggestedMapping,
      newFields: upload.proposedFields,
    });
    expect(
      (await getImportBatch(pahad, upload.batchId)).summary?.imported,
    ).toBe(64);
  });

  it("keeps a failed commit unchanged and imports after failure is off", async () => {
    const upload = await createImportBatch(ctx, file);
    const input = { batchId: upload.batchId, mapping: upload.suggestedMapping };
    const before = structuredClone(data);
    await setDemoFailure(true);
    await expect(commitImport(ctx, input)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(dryRunImport(ctx, input)).rejects.toMatchObject({
      code: "unavailable",
    });
    await setDemoFailure(false);
    expect(await store()).toEqual(before);
    await commitImport(ctx, input);
    expect((await getImportBatch(ctx, upload.batchId)).summary?.imported).toBe(
      38,
    );
  });
});
