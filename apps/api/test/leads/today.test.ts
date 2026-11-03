import { describe, expect, it } from "vitest";
import buckets from "../../src/modules/leads/buckets.js";

const hours = (from: Date, to: Date) =>
  (to.getTime() - from.getTime()) / 3_600_000;

describe("today's local day", () => {
  it("starts at Kathmandu midnight, a quarter hour off UTC", () => {
    const day = buckets.day(
      new Date("2026-10-31T18:20:00.000Z"),
      "Asia/Kathmandu",
    );
    expect(day.start).toEqual(new Date("2026-10-31T18:15:00.000Z"));
    expect(day.end).toEqual(new Date("2026-11-01T18:15:00.000Z"));
    expect(day.dayAgo).toEqual(new Date("2026-10-30T18:20:00.000Z"));
  });

  it("keeps a short and a long day when the clocks change", () => {
    const spring = buckets.day(
      new Date("2026-03-08T15:00:00.000Z"),
      "America/New_York",
    );
    expect(hours(spring.start, spring.end)).toBe(23);
    const autumn = buckets.day(
      new Date("2026-11-01T15:00:00.000Z"),
      "America/New_York",
    );
    expect(hours(autumn.start, autumn.end)).toBe(25);
    const chatham = buckets.day(
      new Date("2026-04-04T23:00:00.000Z"),
      "Pacific/Chatham",
    );
    expect(hours(chatham.start, chatham.end)).toBe(25);
  });

  it("puts each moment in exactly one day, with no gap or overlap", () => {
    const at = new Date("2026-03-07T12:00:00.000Z");
    const first = buckets.day(at, "America/New_York");
    const second = buckets.day(first.end, "America/New_York");
    expect(second.start).toEqual(first.end);
    const last = buckets.day(
      new Date(first.end.getTime() - 1),
      "America/New_York",
    );
    expect(last.start).toEqual(first.start);
  });
});

describe("bucket cursor", () => {
  const day = buckets.day(new Date("2026-10-31T06:00:00.000Z"), "UTC");
  const row = {
    id: "01900000-0000-7000-8000-000000000001",
    next_action_at: new Date("2026-10-31T09:00:00.000Z"),
    assigned_at: new Date("2026-10-31T05:00:00.000Z"),
    rank: 1,
  } as Parameters<typeof buckets.encode>[2];

  it("keeps the first page's time and the last row's sort key", () => {
    expect(
      buckets.decode(buckets.encode("due_today", day, row), "due_today"),
    ).toEqual({
      at: day.at,
      key: ["2026-10-31T09:00:00.000Z", 1, row.id],
    });
    expect(buckets.decode(buckets.encode("new", day, row), "new").key[0]).toBe(
      "2026-10-31T05:00:00.000Z",
    );
  });

  it("refuses a cursor from another bucket or one that was changed", () => {
    const cursor = buckets.encode("overdue", day, row);
    expect(() => buckets.decode(cursor, "new")).toThrow(
      "This page of leads is not valid",
    );
    const text = Buffer.from(cursor, "base64url").toString();
    for (const changed of [
      text.replace("|1|", "|7|"),
      text.replace("2026-10-31T09", "2026-13-31T09"),
      `${text}|extra`,
      "not a cursor",
    ])
      expect(() =>
        buckets.decode(Buffer.from(changed).toString("base64url"), "overdue"),
      ).toThrow("This page of leads is not valid");
  });
});
