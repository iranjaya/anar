import { describe, expect, it } from "vitest";
import { detectEncoding } from "../../src/modules/imports/index.js";

const text = "name,phone\nCafé राम,9841000001\n";
const utf16be = (value: string) => Buffer.from(value, "utf16le").swap16();

describe("encoding detection", () => {
  it.each<[string, Uint8Array, string, number]>([
    [
      "UTF-16 LE with BOM",
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
      "utf-16le",
      2,
    ],
    [
      "UTF-16 BE with BOM",
      Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be(text)]),
      "utf-16be",
      2,
    ],
    [
      "UTF-8 with BOM",
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]),
      "utf-8",
      3,
    ],
    ["UTF-16 LE without BOM", Buffer.from(text, "utf16le"), "utf-16le", 0],
    ["UTF-16 BE without BOM", utf16be(text), "utf-16be", 0],
    ["UTF-8 without BOM", Buffer.from(text), "utf-8", 0],
  ])("finds %s", (_, bytes, encoding, bomLength) => {
    expect(detectEncoding(bytes)).toEqual({
      encoding,
      bomLength,
      warning: null,
    });
  });

  it("falls back to windows-1252 with a warning when the bytes are not UTF-8", () => {
    expect(detectEncoding(Buffer.from("name\nCafé Test\n", "latin1"))).toEqual({
      encoding: "windows-1252",
      bomLength: 0,
      warning: "encoding_fallback",
    });
  });

  it("does not treat a character cut by the 64 KiB sample end as broken", () => {
    const filler = "a".repeat(64 * 1024 - 1);
    expect(detectEncoding(Buffer.from(`${filler}राम\n`)).encoding).toBe(
      "utf-8",
    );
  });

  it("keeps UTF-8 when the provided 64 KiB sample ends inside a character", () => {
    const bytes = Buffer.from(`${"a".repeat(64 * 1024 - 1)}राम\n`);
    expect(detectEncoding(bytes.subarray(0, 64 * 1024))).toMatchObject({
      encoding: "utf-8",
      warning: null,
    });
  });
});
