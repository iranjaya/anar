import { describe, expect, it } from "vitest";
import { leadPageSchema } from "./queue";

const row = {
  id: "01900000-0000-7000-8000-000000000001",
  fullName: "Sita Sharma",
  phoneE164: "+9779841000001",
  phoneValid: true,
  priority: "hot",
  score: 80,
  nextActionAt: null,
  failedAttempts: 0,
  source: "facebook",
  leadDate: "2026-10-31T08:15:30.123Z",
  stage: {
    id: "01900000-0000-7000-8000-000000000002",
    name: "New",
    kind: "open",
  },
  answers: [{ key: "unit_type", label: "2 BHK" }],
  assignedAt: null,
  assignee: null,
  bucket: null,
};

describe("lead queue page from the API", () => {
  it("turns wire dates into dates", () => {
    const page = leadPageSchema.parse({
      items: [{ ...row, nextActionAt: "2026-11-01T04:00:00.000Z" }],
      nextCursor: "next",
      total: 51,
    });
    expect(page.items[0].leadDate).toEqual(
      new Date("2026-10-31T08:15:30.123Z"),
    );
    expect(page.items[0].nextActionAt).toEqual(
      new Date("2026-11-01T04:00:00.000Z"),
    );
    expect(page.items[0].assignedAt).toBe(null);
  });

  it.each([
    ["a date that is not ISO", { leadDate: "31/10/2026" }],
    ["an unknown key", { extra: true }],
    ["an unknown priority", { priority: "boiling" }],
  ])("refuses a row with %s", (_name, change) => {
    expect(
      leadPageSchema.safeParse({
        items: [{ ...row, ...change }],
        nextCursor: null,
        total: 1,
      }).success,
    ).toBe(false);
  });
});
