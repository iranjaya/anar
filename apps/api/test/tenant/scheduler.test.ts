import { describe, expect, it } from "vitest";
import { dueSummaryPeriods } from "../../src/modules/tenant/scheduler.js";

describe("summary scheduler local periods", () => {
  it("starts at Kathmandu 08:00, including its 45-minute offset", () => {
    expect(
      dueSummaryPeriods(new Date("2026-11-02T02:14:59.000Z"), "Asia/Kathmandu"),
    ).toBeNull();
    expect(
      dueSummaryPeriods(new Date("2026-11-02T02:15:00.000Z"), "Asia/Kathmandu"),
    ).toEqual({
      localDate: "2026-11-02",
      weekStart: "2026-10-26",
    });
  });

  it("uses the current local day and prior week after a New York DST change", () => {
    expect(
      dueSummaryPeriods(
        new Date("2026-11-02T12:59:59.000Z"),
        "America/New_York",
      ),
    ).toBeNull();
    expect(
      dueSummaryPeriods(
        new Date("2026-11-02T13:00:00.000Z"),
        "America/New_York",
      ),
    ).toEqual({
      localDate: "2026-11-02",
      weekStart: "2026-10-26",
    });
    expect(
      dueSummaryPeriods(
        new Date("2026-11-03T16:00:00.000Z"),
        "America/New_York",
      ),
    ).toEqual({
      localDate: "2026-11-03",
      weekStart: "2026-10-26",
    });
  });
});
