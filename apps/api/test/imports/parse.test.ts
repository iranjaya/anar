import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  detectDelimiter,
  profileCsv,
} from "../../src/modules/imports/index.js";

const fixtures = join(import.meta.dirname, "../fixtures/csv");
const control = { signal: new AbortController().signal };

describe("csv profile", () => {
  let dir: string;
  let n = 0;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "anar-parse-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  async function file(bytes: Uint8Array | string) {
    const path = join(dir, `${n++}.csv`);
    await writeFile(path, bytes);
    return path;
  }

  it.each<[string, string]>([
    ["a\tb\tc\n1\t2\t3\n", "\t"],
    ["a;b;c\n1;2;3\n", ";"],
    ["a|b|c\n1|2|3\n", "|"],
    ['"a;b;c;d",e,f\n"1;2;3;4",5,6\n', ","],
    ["a,b;c\n", ","],
    ["single\n", ","],
  ])("picks the delimiter of %j", (text, delimiter) => {
    expect(detectDelimiter(text)).toBe(delimiter);
  });

  it("reads a Meta style UTF-16 LE tab file with Devanagari names", async () => {
    const profile = await profileCsv(
      join(fixtures, "meta-utf16le-tab.csv"),
      control,
    );
    expect(profile).toMatchObject({
      encoding: "utf-16le",
      delimiter: "\t",
      rowCount: 4,
      warning: null,
      dateRange: {
        from: new Date("2026-09-12T04:26:12.000Z"),
        to: new Date("2026-10-24T02:30:00.000Z"),
      },
    });
    expect(profile.sample[0][13]).toBe("राम थापा");
    expect(profile.columns[12]).toEqual({
      index: 12,
      original: "when_are_you_planning_to_purchase?_",
      header: "when_are_you_planning_to_purchase?_",
      normalized: "when_are_you_planning_to_purchase",
    });
    const kinds = Object.fromEntries(
      profile.columnKinds.map((k) => [k.header, k]),
    );
    expect(kinds["which_apartment_are_you_planning_to_purchase?"]).toEqual({
      header: "which_apartment_are_you_planning_to_purchase?",
      type: "dropdown",
      options: [
        { value: "2_bhk", label: "2 bhk" },
        { value: "3_bhk", label: "3 bhk" },
        { value: "1_bhk", label: "1 bhk" },
      ],
    });
    expect(kinds.created_time.type).toBe("date");
  });

  it.each<[string, Uint8Array]>([
    [
      "UTF-16 BE without BOM",
      Buffer.from("name\tcity\nराम\tकाठमाडौं\n", "utf16le").swap16(),
    ],
    ["UTF-8 with BOM", Buffer.from("﻿name,city\nराम,काठमाडौं\n")],
  ])("reads %s", async (_, bytes) => {
    const profile = await profileCsv(await file(bytes), control);
    expect(profile.columns.map((c) => c.header)).toEqual(["name", "city"]);
    expect(profile.sample).toEqual([["राम", "काठमाडौं"]]);
  });

  it("reads windows-1252 accents and warns", async () => {
    const profile = await profileCsv(
      await file(Buffer.from("name,city\nCafé Test,Zürich\n", "latin1")),
      control,
    );
    expect(profile.encoding).toBe("windows-1252");
    expect(profile.warning).toBe("encoding_fallback");
    expect(profile.sample).toEqual([["Café Test", "Zürich"]]);
  });

  it("reads UTF-8 without a BOM when the first read splits a character", async () => {
    const header = "full_name,phone\n";
    const name = `${"a".repeat(64 * 1024 - Buffer.byteLength(header) - 1)}राम`;
    const profile = await profileCsv(
      await file(`${header}${name},+12025550100\n`),
      control,
    );
    expect(profile.encoding).toBe("utf-8");
    expect(profile.warning).toBeNull();
    expect(profile.sample[0][0]).toBe(name);
  });

  it("keeps quoted delimiters, quotes and newlines inside one cell", async () => {
    const profile = await profileCsv(
      join(fixtures, "quoted-utf8.csv"),
      control,
    );
    expect(profile.rowCount).toBe(2);
    expect(profile.sample).toEqual([
      ["Shrestha, Test", "9841000002", "line one\r\nline two"],
      ["Test Plain", "9841000003", 'he said "hi"'],
    ]);
  });

  it("names repeated headers apart and skips a title row above the header", async () => {
    const profile = await profileCsv(
      await file("Lead export\nPhone,phone ,Name?\n1,2,3\n"),
      control,
    );
    expect(
      profile.columns.map(({ header, normalized }) => ({ header, normalized })),
    ).toEqual([
      { header: "Phone", normalized: "phone" },
      { header: "phone_2", normalized: "phone_2" },
      { header: "Name?", normalized: "name" },
    ]);
  });

  it("skips blank records, pads short rows and counts long ones", async () => {
    const profile = await profileCsv(
      await file("a,b,c\r\n\r\n,,\r\n1\r\n1,2,3,4\r\n"),
      control,
    );
    expect(profile.rowCount).toBe(2);
    expect(profile.sample).toEqual([
      ["1", "", ""],
      ["1", "2", "3"],
    ]);
  });

  it("guesses dropdown for 12 values, text for 13 and text for an empty column", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => `v${i % 12},w${i % 13},`);
    const profile = await profileCsv(
      await file(`twelve,thirteen,empty\n${rows.join("\n")}\n`),
      control,
    );
    expect(profile.columnKinds.map((k) => [k.type, k.options.length])).toEqual([
      ["dropdown", 12],
      ["text", 0],
      ["text", 0],
    ]);
    expect(profile.sample).toHaveLength(20);
    expect(profile.rowCount).toBe(30);
  });

  it("guesses number and date from the sample", async () => {
    const profile = await profileCsv(
      await file("budget,visit\n1200,2026-09-12\n-3.5,12/09/2026\n,\n"),
      control,
    );
    expect(profile.columnKinds.map((k) => k.type)).toEqual(["number", "date"]);
    expect(profile.dateRange).toBeNull();
  });

  it.each<[string, string | Uint8Array]>([
    ["an empty file", ""],
    ["a file with one column only", "name\nTest\n"],
    ["a header with no rows", "name,phone\n"],
    ["a broken quote", 'name,phone\n"Test,9841000001\n'],
    [
      "binary bytes",
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x2c, 0x00, 0x0a]),
    ],
  ])("refuses %s", async (_, bytes) => {
    await expect(profileCsv(await file(bytes), control)).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("stops reading when the signal aborts", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      profileCsv(join(fixtures, "quoted-utf8.csv"), { signal: abort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
