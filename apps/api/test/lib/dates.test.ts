import { describe, expect, it } from "vitest";
import dates from "../../src/lib/dates.js";

const importedAt = new Date("2026-10-01T00:00:00.000Z");
const np = { defaultCountry: "NP", timezone: "Asia/Kathmandu", importedAt };
const parse = (raw: string | null, input = np) =>
  dates.parseLeadDate(raw, input);

describe("company-local bounds", () => {
  it("keeps Today half-open at Kathmandu midnight", () => {
    const at = new Date("2026-10-28T18:14:59.000Z");
    expect(dates.localDayBounds(at, "Asia/Kathmandu")).toEqual({
      at,
      start: new Date("2026-10-27T18:15:00.000Z"),
      end: new Date("2026-10-28T18:15:00.000Z"),
      dayAgo: new Date("2026-10-27T18:14:59.000Z"),
    });
    expect(
      dates.localDayBounds(
        new Date("2026-10-28T18:15:00.000Z"),
        "Asia/Kathmandu",
      ).start,
    ).toEqual(new Date("2026-10-28T18:15:00.000Z"));
  });

  it("uses the previous local Monday-to-Monday week, including a DST change", () => {
    const beforeMonday = dates.previousLocalWeekBounds(
      new Date("2026-11-02T04:59:59.000Z"),
      "America/New_York",
    );
    expect(beforeMonday).toEqual({
      weekStart: "2026-10-19",
      weekEnd: "2026-10-26",
      start: new Date("2026-10-19T04:00:00.000Z"),
      end: new Date("2026-10-26T04:00:00.000Z"),
    });
    expect(
      dates.previousLocalWeekBounds(
        new Date("2026-11-02T05:00:00.000Z"),
        "America/New_York",
      ),
    ).toEqual({
      weekStart: "2026-10-26",
      weekEnd: "2026-11-02",
      start: new Date("2026-10-26T04:00:00.000Z"),
      end: new Date("2026-11-02T05:00:00.000Z"),
    });
  });

  it("keeps the quarter-hour offset on Kathmandu week boundaries", () => {
    expect(
      dates.previousLocalWeekBounds(
        new Date("2026-11-02T02:15:00.000Z"),
        "Asia/Kathmandu",
      ),
    ).toEqual({
      weekStart: "2026-10-26",
      weekEnd: "2026-11-02",
      start: new Date("2026-10-25T18:15:00.000Z"),
      end: new Date("2026-11-01T18:15:00.000Z"),
    });
  });
});

describe("lead date parsing", () => {
  it.each([
    ["2026-09-12T10:11:12+05:45", "2026-09-12T04:26:12.000Z"],
    ["2026-09-12T10:11:12+0545", "2026-09-12T04:26:12.000Z"],
    ["2026-09-12T10:11:12.5Z", "2026-09-12T10:11:12.500Z"],
    ["2026-09-12T10:11:12-04:00", "2026-09-12T14:11:12.000Z"],
  ])("lets the offset in %j win", (raw, iso) => {
    expect(parse(raw)).toEqual({ value: new Date(iso), issue: null });
  });

  it("reads a date and time without offset in the company timezone", () => {
    expect(parse("2026-03-04 10:00")).toEqual({
      value: new Date("2026-03-04T04:15:00.000Z"),
      issue: null,
    });
    expect(parse("2026-03-04")).toEqual({
      value: new Date("2026-03-03T18:15:00.000Z"),
      issue: null,
    });
  });

  it("reads an ambiguous date day first in Nepal and month first in the US", () => {
    expect(parse("04/03/2026").value).toEqual(
      new Date("2026-03-03T18:15:00.000Z"),
    );
    expect(
      parse("04/03/2026", { ...np, defaultCountry: "US", timezone: "UTC" })
        .value,
    ).toEqual(new Date("2026-04-03T00:00:00.000Z"));
  });

  it("reads a date that can only be one way in any country", () => {
    const us = { ...np, defaultCountry: "US", timezone: "UTC" };
    expect(parse("13/03/2026", us).value).toEqual(
      new Date("2026-03-13T00:00:00.000Z"),
    );
    expect(parse("03/13/2026", np).value).toEqual(
      new Date("2026-03-12T18:15:00.000Z"),
    );
  });

  it("refuses an ambiguous date for a country with no known order", () => {
    expect(() =>
      parse("04/03/2026", { ...np, defaultCountry: "GB" }),
    ).toThrowError(expect.objectContaining({ code: "validation" }));
  });

  it.each([
    null,
    "",
    "yesterday",
    "2026-02-30",
    "31/02/2026",
    "2026-09-12T25:00",
  ])("uses the import time with bad_date for %j", (raw) => {
    expect(parse(raw)).toEqual({ value: importedAt, issue: "bad_date" });
  });
});
