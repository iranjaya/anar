import {
  type NotificationInput,
  notificationInputSchema,
  notificationSlug,
} from "@anar/domain/notifications";
import { describe, expect, it } from "vitest";

const companyId = "a1000000-0000-4000-8000-000000000001";
const batchId = "01900000-0000-7000-8000-000000000001";
const leadId = "01900000-0000-7000-8000-000000000002";
const input: NotificationInput = {
  companyId,
  userId: "c0000000-0000-4000-8000-000000000001",
  title: "Import finished",
  body: "120 leads imported, 4 already in the list.",
  url: `/client-one/imports/${batchId}`,
  dedupeKey: `import:${companyId}:${batchId}:complete`,
  data: { type: "import_complete", batchId, imported: 120, duplicateDb: 4 },
};
const valid = (overrides: Partial<NotificationInput>) =>
  notificationInputSchema.safeParse({ ...input, ...overrides }).success;

describe("notification input", () => {
  it.each<[string, Partial<NotificationInput>]>([
    ["an import", {}],
    [
      "an assignment",
      {
        url: "/client-one/today",
        dedupeKey: `assign:${companyId}:${batchId}`,
        data: { type: "assigned", assignmentId: batchId, count: 3 },
      },
    ],
    [
      "a lost suggestion",
      {
        url: `/client-one/leads/${leadId}`,
        dedupeKey: `lost:${companyId}:${leadId}:${batchId}`,
        data: { type: "lost_suggested", leadId, failedAttempts: 5 },
      },
    ],
    [
      "an overdue lead",
      {
        url: `/client-one/leads/${leadId}`,
        dedupeKey: `overdue:${companyId}:${leadId}:2026-10-31`,
        data: { type: "overdue", leadId, localDate: "2026-10-31" },
      },
    ],
    [
      "a daily summary",
      {
        url: "/client-one/today",
        dedupeKey: `daily:${companyId}:2026-10-31`,
        data: {
          type: "daily",
          localDate: "2026-10-31",
          overdue: 2,
          dueToday: 5,
          newLeads: 0,
        },
      },
    ],
    [
      "a weekly summary",
      {
        url: "/client-one/notifications",
        dedupeKey: `weekly:${companyId}:2026-10-26`,
        data: {
          type: "weekly",
          weekStart: "2026-10-26",
          leads: 40,
          calls: 90,
          siteVisits: 3,
          bookings: 1,
          overdue: 6,
          staffCalls: 12,
          top: { name: "A", calls: 22, tied: false },
          bottom: { name: "B", calls: 3, tied: true },
        },
      },
    ],
    ["the company home", { url: "/client-one" }],
  ])("accepts %s", (_name, overrides) => {
    expect(valid(overrides)).toBe(true);
  });

  it.each<[string, Partial<NotificationInput>]>([
    ["an absolute link", { url: "https://evil.example/client-one" }],
    ["a protocol-relative link", { url: "//evil.example/client-one" }],
    ["a javascript link", { url: "javascript:alert(1)" }],
    ["a path with ..", { url: "/client-one/../other/today" }],
    ["a page that is not a target", { url: "/client-one/settings/team" }],
    ["a query string", { url: "/client-one/today?x=1" }],
    ["a lead link without an ID", { url: "/client-one/leads/abc" }],
    ["a key without the company", { dedupeKey: `import:${batchId}:complete` }],
    ["a key for another type", { dedupeKey: `daily:${companyId}:2026-10-31` }],
    ["a title over 160", { title: "a".repeat(161) }],
    ["an empty body", { body: "  " }],
    ["a body over 500", { body: "a".repeat(501) }],
    ["a key over 240", { dedupeKey: `import:${companyId}:${"a".repeat(240)}` }],
    [
      "a negative count",
      {
        data: {
          type: "import_complete",
          batchId,
          imported: -1,
          duplicateDb: 0,
        },
      },
    ],
    [
      "a fraction count",
      {
        data: {
          type: "import_complete",
          batchId,
          imported: 1.5,
          duplicateDb: 0,
        },
      },
    ],
    [
      "a bad local date",
      {
        dedupeKey: `overdue:${companyId}:${leadId}:2026-13-01`,
        data: { type: "overdue", leadId, localDate: "2026-13-01" },
      },
    ],
  ])("rejects %s", (_name, overrides) => {
    expect(valid(overrides)).toBe(false);
  });

  it("rejects lead details stored in the data", () => {
    expect(
      notificationInputSchema.safeParse({
        ...input,
        data: { ...input.data, phone: "+9779800000000" },
      }).success,
    ).toBe(false);
  });

  it("rejects a second type field next to the data", () => {
    expect(
      notificationInputSchema.safeParse({ ...input, type: "daily" }).success,
    ).toBe(false);
  });

  it("reads the company slug from a target link", () => {
    expect(notificationSlug(`/client-one/imports/${batchId}`)).toBe(
      "client-one",
    );
    expect(notificationSlug("/client-one")).toBe("client-one");
    expect(notificationSlug("/client-one/notifications")).toBe("client-one");
  });
});
