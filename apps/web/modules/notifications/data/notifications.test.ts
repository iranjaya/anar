import { describe, expect, it } from "vitest";
import { notificationPageSchema } from "./notifications";

const companyId = "a1000000-0000-4000-8000-000000000001";
const leadId = "01900000-0000-7000-8000-000000000002";
const wireItem = {
  id: "01900000-0000-7000-8000-000000000001",
  companyId,
  userId: "c0000000-0000-4000-8000-000000000001",
  type: "overdue",
  title: "Lead overdue",
  body: "A lead is overdue.",
  url: `/client-one/leads/${leadId}`,
  dedupeKey: `overdue:${companyId}:${leadId}:2026-10-31`,
  data: { type: "overdue", leadId, localDate: "2026-10-31" },
  readAt: null,
  pushedAt: null,
  emailedAt: null,
  createdAt: "2026-10-31T08:15:30.123Z",
};

describe("notification page from the API", () => {
  it("turns wire times into dates and keeps unread as null", () => {
    const page = notificationPageSchema.parse({
      items: [{ ...wireItem, readAt: "2026-10-31T09:00:00.000Z" }, wireItem],
      nextCursor: "abc",
      unreadCount: 1,
    });
    expect(page.items[0].readAt).toEqual(new Date("2026-10-31T09:00:00.000Z"));
    expect(page.items[0].createdAt).toEqual(
      new Date("2026-10-31T08:15:30.123Z"),
    );
    expect(page.items[1].readAt).toBeNull();
  });

  it.each([
    ["a link to another site", { url: "https://evil.example/client-one" }],
    ["a bad time", { createdAt: "yesterday" }],
    ["an unknown field", { phone: "+9779800000000" }],
  ])("rejects %s", (_name, change) => {
    expect(
      notificationPageSchema.safeParse({
        items: [{ ...wireItem, ...change }],
        nextCursor: null,
        unreadCount: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects a missing unread count instead of showing zero", () => {
    expect(
      notificationPageSchema.safeParse({ items: [], nextCursor: null }).success,
    ).toBe(false);
  });
});
