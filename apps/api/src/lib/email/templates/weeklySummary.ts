import type { NotificationData } from "@anar/domain/notifications";
import layout, { type RenderedEmail } from "./layout.js";

type WeeklyData = Extract<NotificationData, { type: "weekly" }>;

function rank(value: WeeklyData["top"]): string {
  if (!value) return "No Admin calls";
  return `${value.name}: ${value.calls}${value.tied ? " (tied)" : ""}`;
}

const weeklySummary = {
  render(input: {
    company: string;
    url: string;
    data: WeeklyData;
  }): RenderedEmail {
    const { company, url, data } = input;
    return {
      subject: `${company}: week of ${data.weekStart}`,
      ...layout.render({
        preheader: `${data.leads} leads, ${data.calls} Admin calls, ${data.staffCalls} staff calls.`,
        company,
        blocks: [
          layout.heading("Your weekly summary", `Week of ${data.weekStart}`),
          layout.stats(
            [
              { value: data.leads, label: "Leads", tone: "new" },
              { value: data.calls, label: "Admin calls", tone: "call" },
              { value: data.staffCalls, label: "Staff calls", tone: "plain" },
              { value: data.siteVisits, label: "Site visits", tone: "brand" },
              { value: data.bookings, label: "Bookings", tone: "brand" },
              { value: data.overdue, label: "Overdue", tone: "overdue" },
            ],
            3,
          ),
          layout.rows([
            ["Top Admin calls", rank(data.top)],
            ["Bottom Admin calls", rank(data.bottom)],
          ]),
          layout.button("Open notifications", url),
          layout.linkFallback(url),
        ],
        footer: {
          reason: `You received this weekly summary for ${company}.`,
          operator: "Open Anar for the latest lead details.",
          contact: "Your team manages these leads in Anar.",
        },
      }),
    };
  },
};
export default weeklySummary;
