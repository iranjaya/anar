import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatDay,
  formatDue,
  localDateAfterDays,
  localDateAtTen,
} from "./dates";

describe("dates", () => {
  const zone = "Asia/Kathmandu";
  it("moves to the next Kathmandu date across midnight", () => {
    expect(
      localDateAfterDays(new Date("2026-10-28T18:14:59Z"), 1, "Asia/Kathmandu"),
    ).toBe("2026-10-29");
    expect(localDateAtTen("2026-10-29", "Asia/Kathmandu").toISOString()).toBe(
      "2026-10-29T04:15:00.000Z",
    );
  });

  it("keeps 10:00 local through both New York clock changes", () => {
    expect(
      localDateAfterDays(
        new Date("2026-03-07T20:00:00Z"),
        1,
        "America/New_York",
      ),
    ).toBe("2026-03-08");
    expect(localDateAtTen("2026-03-08", "America/New_York").toISOString()).toBe(
      "2026-03-08T14:00:00.000Z",
    );
    expect(localDateAtTen("2026-11-01", "America/New_York").toISOString()).toBe(
      "2026-11-01T15:00:00.000Z",
    );
  });
  it("shows yesterday's clock time at 08:00", () => {
    expect(
      formatDay(
        new Date("2026-10-27T23:47:00+05:45"),
        zone,
        new Date("2026-10-28T08:00:00+05:45"),
      ),
    ).toBe("Yesterday 23:47");
  });

  it("formats the clock in Kathmandu", () => {
    expect(formatClock(new Date("2026-10-28T05:45:00Z"), zone)).toBe("11:30");
  });

  it("changes the day label at Kathmandu midnight", () => {
    const date = new Date("2026-10-28T18:02:00Z");
    expect(formatDay(date, zone, new Date("2026-10-28T18:14:59Z"))).toBe(
      "Today 23:47",
    );
    expect(formatDay(date, zone, new Date("2026-10-28T18:15:00Z"))).toBe(
      "Yesterday 23:47",
    );
  });

  it("shows tomorrow's date after Kathmandu midnight", () => {
    expect(
      formatDay(
        new Date("2026-10-28T18:15:00Z"),
        zone,
        new Date("2026-10-28T18:14:59Z"),
      ),
    ).toBe("Tomorrow 00:00");
  });

  describe("formatDue", () => {
    const now = new Date("2026-10-28T15:00:00+05:45");

    it.each([
      ["2026-10-28T10:00:00+05:45", "Overdue 5 hours"],
      ["2026-10-28T14:00:00+05:45", "Overdue 1 hour"],
      ["2026-10-28T14:59:59+05:45", "Overdue 1 hour"],
      ["2026-10-27T15:00:01+05:45", "Overdue 23 hours"],
      ["2026-10-27T15:00:00+05:45", "Overdue 1 day"],
      ["2026-10-26T15:00:00+05:45", "Overdue 2 days"],
      ["2026-10-28T15:00:00+05:45", "Due 15:00"],
      ["2026-10-29T10:00:00+05:45", "Due Tomorrow 10:00"],
    ])("formats %s as %s", (date, expected) => {
      expect(formatDue(new Date(date), zone, now)).toBe(expected);
    });

    it("shows the due clock time later today", () => {
      expect(
        formatDue(
          new Date("2026-10-28T11:30:00+05:45"),
          zone,
          new Date("2026-10-28T08:00:00+05:45"),
        ),
      ).toBe("Due 11:30");
    });

    it("keeps overdue hours across Kathmandu midnight", () => {
      const date = new Date("2026-10-28T22:00:00+05:45");
      expect(formatDue(date, zone, new Date("2026-10-28T23:59:59+05:45"))).toBe(
        "Overdue 1 hour",
      );
      expect(formatDue(date, zone, new Date("2026-10-29T00:00:00+05:45"))).toBe(
        "Overdue 2 hours",
      );
    });
  });

  it("uses the company timezone for clock and local day labels", () => {
    const at = new Date("2026-11-01T03:30:00.000Z");
    const now = new Date("2026-11-01T04:30:00.000Z");
    expect(formatClock(at, "America/New_York")).toBe("23:30");
    expect(formatClock(at, zone)).toBe("09:15");
    expect(formatDay(at, "America/New_York", now)).toBe("Yesterday 23:30");
    expect(formatDay(at, zone, now)).toBe("Today 09:15");
    expect(formatDue(at, "America/New_York", now)).toBe("Overdue 1 hour");
  });
});
