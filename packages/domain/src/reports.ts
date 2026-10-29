import type { Lead, TodayCounts } from "./leads.js";
import type { Stage } from "./settings.js";

export type Range = { from: Date; to: Date };
export type Target = {
  id: string;
  companyId: string;
  memberId: string;
  metric: "calls" | "site_visits" | "bookings";
  period: "day" | "week" | "month";
  value: number;
  startsOn: Date;
  endsOn: Date | null;
};
export type TeamOverview = {
  tiles: {
    newToday: number;
    unassigned: number;
    overdue: number;
    siteVisitsThisWeek: number;
    bookingsThisMonth: number;
    bookingsTarget: number | null;
  };
  perMember: {
    memberId: string;
    name: string;
    leadsHeld: number;
    calls: number;
    callsTarget: number | null;
    overdue: number;
    siteVisits: number;
    bookings: number;
    hot: number;
    warm: number;
    cold: number;
    hotIdle2d: number;
  }[];
  funnel: {
    stageId: string;
    name: string;
    kind: Stage["kind"];
    count: number;
  }[];
  bySource: { source: Lead["source"]; count: number }[];
};
export type MemberDashboard = {
  counts: Pick<TodayCounts, "overdue" | "dueToday" | "newLeads">;
  targets: (Pick<Target, "metric" | "period" | "value"> & { actual: number })[];
};
export type Metrics = {
  calls: number;
  medianResponseHours: number | null;
  siteVisits: number;
  bookings: number;
  conversion: number;
};
