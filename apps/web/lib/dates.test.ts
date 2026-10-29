import { describe, expect, it } from "vitest";
import { formatClock, formatDay, formatDue } from "./dates";

describe("dates", () => {
  it("shows yesterday's clock time at 08:00", () => {
    expect(
      formatDay(
        new Date("2026-10-27T23:47:00+05:45"),
        new Date("2026-10-28T08:00:00+05:45"),
      ),
    ).toBe("Yesterday 23:47");
  });

  it("formats the clock in Kathmandu", () => {
    expect(formatClock(new Date("2026-10-28T05:45:00Z"))).toBe("11:30");
  });

  it("changes the day label at Kathmandu midnight", () => {
    const date = new Date("2026-10-28T18:02:00Z");
    expect(formatDay(date, new Date("2026-10-28T18:14:59Z"))).toBe(
      "Today 23:47",
    );
    expect(formatDay(date, new Date("2026-10-28T18:15:00Z"))).toBe(
      "Yesterday 23:47",
    );
  });

  it("shows tomorrow's date after Kathmandu midnight", () => {
    expect(
      formatDay(
        new Date("2026-10-28T18:15:00Z"),
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
      expect(formatDue(new Date(date), now)).toBe(expected);
    });

    it("shows the due clock time later today", () => {
      expect(
        formatDue(
          new Date("2026-10-28T11:30:00+05:45"),
          new Date("2026-10-28T08:00:00+05:45"),
        ),
      ).toBe("Due 11:30");
    });

    it("keeps overdue hours across Kathmandu midnight", () => {
      const date = new Date("2026-10-28T22:00:00+05:45");
      expect(formatDue(date, new Date("2026-10-28T23:59:59+05:45"))).toBe(
        "Overdue 1 hour",
      );
      expect(formatDue(date, new Date("2026-10-29T00:00:00+05:45"))).toBe(
        "Overdue 2 hours",
      );
    });
  });
});
