import type { NotificationData } from "@anar/domain/notifications";
import layout, { type RenderedEmail } from "./layout.js";

type DailyData = Extract<NotificationData, { type: "daily" }>;

const dailySummary = {
  render(input: {
    company: string;
    url: string;
    data: DailyData;
  }): RenderedEmail {
    const { company, url, data } = input;
    return {
      subject: `${company}: your ${data.localDate} work`,
      ...layout.render({
        preheader: `${data.overdue} overdue, ${data.dueToday} due today, ${data.newLeads} new leads.`,
        company,
        blocks: [
          layout.heading("Your work today", data.localDate),
          layout.stats([
            { value: data.overdue, label: "Overdue", tone: "overdue" },
            { value: data.dueToday, label: "Due today", tone: "due" },
            { value: data.newLeads, label: "New leads", tone: "new" },
          ]),
          layout.button("Open Today", url),
          layout.linkFallback(url),
        ],
        footer: {
          reason: `You received this work summary for ${company}.`,
          operator: "Open Anar for the latest lead details.",
          contact: "Your team manages these leads in Anar.",
        },
      }),
    };
  },
};
export default dailySummary;
