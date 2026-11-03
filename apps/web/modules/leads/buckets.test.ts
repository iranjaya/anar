import { describe, expect, it } from "vitest";
import { bucketOf, nextDueText } from "./buckets";

const timezone = "Asia/Kathmandu";
const now = new Date("2026-10-28T12:00:00+05:45");
const lead: Parameters<typeof bucketOf>[0] = {
  nextActionAt: new Date("2026-10-28T23:50:00+05:45"),
  stageKind: "open",
  assignedTo: "sundar-heights-sunaina",
  assignedAt: new Date("2026-10-28T00:00:00+05:45"),
  followUpCount: 0,
};

describe("bucketOf", () => {
  it.each([
    ["2026-10-28T00:10:00+05:45", "due_today"],
    ["2026-10-28T23:50:00+05:45", "due_today"],
    ["2026-10-28T23:55:00+05:45", "overdue"],
  ] as const)(
    "puts a 23:50 call in %s's %s bucket before new",
    (time, bucket) => {
      expect(bucketOf(lead, new Date(time), timezone)).toBe(bucket);
    },
  );

  it("starts the local day at Kathmandu midnight", () => {
    const due = {
      ...lead,
      nextActionAt: new Date("2026-10-28T18:15:00Z"),
      followUpCount: 1,
    };
    expect(
      bucketOf(due, new Date("2026-10-28T18:14:59Z"), timezone),
    ).toBeNull();
    expect(bucketOf(due, new Date("2026-10-28T18:15:00Z"), timezone)).toBe(
      "due_today",
    );
    expect(bucketOf(due, new Date("2026-10-28T18:15:01Z"), timezone)).toBe(
      "overdue",
    );
  });

  it.each(["won", "lost"] as const)(
    "leaves %s leads out of every bucket",
    (stageKind) => {
      expect(
        bucketOf(
          { ...lead, stageKind, nextActionAt: lead.assignedAt },
          now,
          timezone,
        ),
      ).toBeNull();
    },
  );

  it.each([lead.assignedAt, lead.nextActionAt, null])(
    "leaves unassigned leads out when next action is %s",
    (nextActionAt) => {
      expect(
        bucketOf({ ...lead, assignedTo: null, nextActionAt }, now, timezone),
      ).toBeNull();
    },
  );

  it.each([
    ["2026-10-28T12:00:00+05:45", "new"],
    ["2026-10-27T12:00:00.001+05:45", "new"],
    ["2026-10-27T12:00:00+05:45", null],
    ["2026-10-27T11:59:59+05:45", null],
    ["2026-10-28T12:00:00.001+05:45", null],
    [null, null],
  ] as const)(
    "uses the 24 hour window for an assignment at %s",
    (time, bucket) => {
      expect(
        bucketOf(
          {
            ...lead,
            nextActionAt: null,
            assignedAt: time === null ? null : new Date(time),
          },
          now,
          timezone,
        ),
      ).toBe(bucket);
    },
  );

  it("leaves a contacted lead out of new", () => {
    expect(
      bucketOf(
        { ...lead, nextActionAt: null, followUpCount: 1 },
        now,
        timezone,
      ),
    ).toBeNull();
  });
});

describe("nextDueText", () => {
  const at = new Date("2026-10-31T22:30:00.000Z");
  const next = new Date("2026-11-01T03:30:00.000Z");

  it("uses the company's day and clock, not Kathmandu's", () => {
    expect(nextDueText(next, at, "America/New_York")).toBe(
      "Next one is due Today 23:30",
    );
    expect(nextDueText(next, at, "Asia/Kathmandu")).toBe(
      "Next one is due Today 09:15",
    );
    expect(
      nextDueText(new Date("2026-11-01T14:00:00.000Z"), at, "America/New_York"),
    ).toBe("Next one is due tomorrow at 09:00");
  });

  it("names a later date and says when nothing is next", () => {
    expect(
      nextDueText(new Date("2026-11-05T14:00:00.000Z"), at, "America/New_York"),
    ).toBe("Next one is due 5 Nov 2026 09:00");
    expect(nextDueText(null, at, "America/New_York")).toBe(
      "No calls scheduled next.",
    );
  });
});
