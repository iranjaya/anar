import { describe, expect, it } from "vitest";
import dailySummary from "../../src/lib/email/templates/dailySummary.js";
import weeklySummary from "../../src/lib/email/templates/weeklySummary.js";

describe("summary email templates", () => {
  it("renders zero daily counts and escapes the company name", () => {
    const email = dailySummary.render({
      company: '<North & "East">',
      url: "https://anar.example.test/north/today",
      data: {
        type: "daily",
        localDate: "2026-11-02",
        overdue: 0,
        dueToday: 0,
        newLeads: 0,
      },
    });
    expect(email.text).toContain("0  Overdue");
    expect(email.text).toContain("https://anar.example.test/north/today");
    expect(email.html).toContain("&lt;North &amp; &quot;East&quot;&gt;");
    expect(email.html).not.toContain('<North & "East">');
  });

  it("renders zero weekly counts and escapes ranked names", () => {
    const email = weeklySummary.render({
      company: "North",
      url: "https://anar.example.test/north/notifications",
      data: {
        type: "weekly",
        weekStart: "2026-10-26",
        leads: 0,
        calls: 0,
        siteVisits: 0,
        bookings: 0,
        overdue: 0,
        staffCalls: 0,
        top: { name: "<Admin & One>", calls: 0, tied: true },
        bottom: null,
      },
    });
    expect(email.text).toContain("Staff calls");
    expect(email.text).toContain("No Admin calls");
    expect(email.text).toContain("<Admin & One>: 0 (tied)");
    expect(email.html).toContain("&lt;Admin &amp; One&gt;");
    expect(email.html).not.toContain("<Admin & One>");
  });
});
