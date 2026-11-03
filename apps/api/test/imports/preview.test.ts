import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImportMatch } from "@anar/domain/leads";
import type { Field } from "@anar/domain/settings";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ImportDeps } from "../../src/modules/imports/index.js";
import mapping from "../../src/modules/imports/mapping.js";
import preview from "../../src/modules/imports/preview.js";
import type { StoredBatch } from "../../src/modules/imports/repository.js";
import type { Ctx } from "../../src/modules/tenant/index.js";

const batchId = "01900000-0000-7000-8000-000000000001";
const createdAt = new Date("2026-10-30T00:00:00.000Z");
const headers = ["full_name", "phone", "created_time", "campaign_name", "unit"];
const unit: Field = {
  id: "01900000-0000-7000-8000-000000000009",
  companyId: "b0000000-0000-4000-8000-000000000001",
  key: "unit",
  label: "Unit",
  type: "dropdown",
  options: [{ value: "2_bhk", label: "2 BHK" }],
  isSystem: false,
  position: 10,
  archivedAt: null,
};
const input = {
  batchId,
  mapping: [
    { header: "full_name", target: "system:full_name" as const },
    { header: "phone", target: "system:phone" as const },
    { header: "created_time", target: "system:lead_date" as const },
    { header: "campaign_name", target: "system:campaign_name" as const },
    { header: "unit", target: "field:unit" as const },
  ],
  newFields: [],
  expectedRevision: 0,
};
const phone = (n: number) => `+97798410${String(n).padStart(5, "0")}`;
const at = "2026-09-12T10:11:12+05:45";
const stored = new Date("2026-09-12T04:26:12.000Z");

describe("preview counts every row and keeps only the first 50 per group", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "anar-preview-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function scan(lines: string[], matches: ImportMatch[] = []) {
    const name = `${lines.length}-${Math.random()}.csv`;
    await writeFile(
      join(root, name),
      [headers.join(","), ...lines, ""].join("\n"),
    );
    const lookups: string[][] = [];
    const deps = {
      uploadsRoot: root,
      context: {
        withContext: async (_actor: Ctx, fn: (tx: never, c: Ctx) => unknown) =>
          fn(
            {} as never,
            {
              role: "agency_staff",
              agencyId: "a0000000-0000-4000-8000-000000000001",
              companyId: unit.companyId,
            } as unknown as Ctx,
          ),
      },
      findImportMatches: async (
        _tx: never,
        { phones }: { phones: string[] },
      ) => {
        lookups.push(phones);
        return matches.filter((m) => phones.includes(m.phoneE164));
      },
    } as unknown as ImportDeps;
    const batch = {
      id: batchId,
      filePath: name,
      createdAt,
      profile: { columns: mapping.headerColumns(headers) },
    } as unknown as StoredBatch;
    const result = await preview._scan(
      deps,
      {} as Ctx,
      input,
      {
        batch,
        revision: 3,
        schemaKey: "",
        fields: [unit],
        company: { defaultCountry: "NP", timezone: "Asia/Kathmandu" },
      },
      { signal: new AbortController().signal },
      createHash("sha256"),
    );
    return { result, lookups };
  }

  it("lets the first phone win, then counts later copies as file duplicates even when the first is in the list", async () => {
    const matches: ImportMatch[] = [
      {
        leadId: "01900000-0000-7000-8000-00000000000a",
        phoneE164: phone(1),
        campaignName: "Spring",
        leadDate: stored,
      },
      {
        leadId: "01900000-0000-7000-8000-00000000000b",
        phoneE164: phone(2),
        campaignName: null,
        leadDate: stored,
      },
      {
        leadId: "01900000-0000-7000-8000-00000000000c",
        phoneE164: phone(3),
        campaignName: "Spring",
        leadDate: stored,
      },
    ];
    const { result } = await scan(
      [
        `Same,${phone(1)},${at},Spring,2_bhk`,
        `No campaign,${phone(2)},${at},,2_bhk`,
        `Came back,${phone(3)},2026-10-01T09:00:00+05:45,Spring,2_bhk`,
        `New,${phone(4)},${at},Spring,3_bhk`,
        `Copy,${phone(1)},${at},Spring,2_bhk`,
        `Bad phone,12345,${at},Spring,4_bhk`,
        `Too wide,${phone(5)},${at},Spring,2_bhk,extra`,
      ],
      matches,
    );
    expect(result).toMatchObject({
      toAdd: 2,
      needPhoneReview: 1,
      sameSubmission: 2,
      counts: { rowCount: 7, resubmitted: 1, duplicateFile: 1, invalid: 1 },
      previewRevision: 3,
    });
    const { toAdd, sameSubmission, counts } = result;
    expect(
      toAdd +
        sameSubmission +
        counts.resubmitted +
        counts.duplicateFile +
        counts.invalid,
    ).toBe(counts.rowCount);
    expect(result.resubmitted).toEqual([
      expect.objectContaining({
        id: `${batchId}:3`,
        rowNo: 3,
        result: "duplicate_db",
        reason: "resubmitted",
        leadId: matches[2].leadId,
        display: { fullName: "Came back", phoneRaw: phone(3) },
      }),
    ]);
    expect(result.duplicateFile.map((r) => [r.id, r.result])).toEqual([
      [`${batchId}:5`, "duplicate_file"],
    ]);
    expect(
      result.phoneReview.map((r) => [r.rowNo, r.reason, r.phoneE164]),
    ).toEqual([[6, "invalid_phone", null]]);
    expect(
      result.invalidRows.map((r) => [r.rowNo, r.issues.map((i) => i.code)]),
    ).toEqual([[7, ["column_count"]]]);
    expect(result.invalidRows[0].raw).toEqual({
      full_name: "Too wide",
      phone: phone(5),
      created_time: at,
      campaign_name: "Spring",
      unit: "2_bhk",
    });
  });

  it("lists each new answer once and leaves the field alone", async () => {
    const { result } = await scan([
      `A,${phone(1)},${at},,3_bhk`,
      `B,${phone(2)},${at},,3_bhk`,
      `C,${phone(3)},${at},,4_bhk`,
    ]);
    expect(result.newOptions).toEqual([
      { fieldKey: "unit", option: { value: "3_bhk", label: "3 bhk" } },
      { fieldKey: "unit", option: { value: "4_bhk", label: "4 bhk" } },
    ]);
    expect(unit.options).toEqual([{ value: "2_bhk", label: "2 BHK" }]);
  });

  it("keeps 50 rows per group but counts all of them, looking up 500 phones at a time", async () => {
    const lines = [
      ...Array.from(
        { length: 1201 },
        (_, n) => `Lead ${n},${phone(n)},${at},Spring,2_bhk`,
      ),
      ...Array.from(
        { length: 70 },
        (_, n) => `Copy ${n},${phone(n)},${at},Spring,2_bhk`,
      ),
      ...Array.from(
        { length: 60 },
        (_, n) => `Bad ${n},1${n},${at},Spring,2_bhk`,
      ),
    ];
    const { result, lookups } = await scan(lines);
    expect(lookups.map((phones) => phones.length)).toEqual([500, 500, 201]);
    expect(result.counts).toEqual({
      rowCount: 1331,
      resubmitted: 0,
      duplicateFile: 70,
      invalid: 0,
    });
    expect(result.toAdd).toBe(1261);
    expect(result.needPhoneReview).toBe(60);
    expect(result.duplicateFile).toHaveLength(50);
    expect(result.phoneReview).toHaveLength(50);
  });

  it("gives honest zeros for a file with no valid rows", async () => {
    const { result, lookups } = await scan([
      `Too wide,${phone(1)},${at},Spring,2_bhk,x`,
    ]);
    expect(lookups).toEqual([]);
    expect(result).toMatchObject({
      toAdd: 0,
      sameSubmission: 0,
      counts: { rowCount: 1, invalid: 1 },
    });
  });
});
