import type { MemberDashboard, TeamOverview } from "../types";

export function MemberPanel({
  dashboard,
  member,
}: {
  dashboard: MemberDashboard;
  member: TeamOverview["perMember"][number];
}) {
  const labels = {
    calls: "Calls",
    site_visits: "Site visits",
    bookings: "Bookings",
  };
  const periods = { day: "today", week: "this week", month: "this month" };
  return (
    <section
      aria-label={`${member.name} detail`}
      className="space-y-3 rounded-xl bg-bg p-4"
    >
      <h3 className="font-semibold">{member.name}</h3>
      <p className="text-sm">
        Now: {dashboard.counts.overdue} overdue · {dashboard.counts.dueToday}{" "}
        due today · {dashboard.counts.newLeads} new
      </p>
      <p className="text-sm">
        Leads held: {member.hot} hot · {member.warm} warm · {member.cold} cold
      </p>
      <ul className="grid gap-2 lg:grid-cols-2">
        {dashboard.targets.map((target) => (
          <li key={`${target.metric}/${target.period}`} className="text-sm">
            {labels[target.metric]} · {periods[target.period]}:{" "}
            <strong>
              {target.actual} / {target.value}
            </strong>
            <progress
              aria-label={`${labels[target.metric]} ${periods[target.period]}`}
              value={target.actual}
              max={target.value}
              className="block h-2 w-full accent-brand"
            />
          </li>
        ))}
      </ul>
      {dashboard.targets.length === 0 && (
        <p className="text-sm text-muted">No targets set</p>
      )}
    </section>
  );
}
