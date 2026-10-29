import { tz } from "@date-fns/tz";
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { AppError } from "@/lib/errors";
import { AssignList } from "@/modules/leads/components";
import { listLeads } from "@/modules/leads/server";
import { listMembers } from "@/modules/members/server";
import { can, homeFor, requireContext } from "@/modules/tenant/server";
import { compareMembers, getMemberDashboard, getTeamOverview } from "../server";
import { Compare } from "./Compare";
import { Funnel } from "./Funnel";
import { MemberPanel } from "./MemberPanel";
import { RangePicker } from "./RangePicker";
import { TeamTable } from "./TeamTable";
import { Tiles } from "./Tiles";

export async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const ctx = await requireContext(slug);
  if (!can(ctx, "reports.view_all")) redirect(homeFor(ctx));
  const query = await searchParams;
  const now = new Date();
  const local = { in: tz("Asia/Kathmandu") };
  let value = "week";
  let rangeLabel = "this week";
  let range = {
    from: startOfWeek(now, { ...local, weekStartsOn: 1 }),
    to: endOfWeek(now, { ...local, weekStartsOn: 1 }),
  };
  if (query.range === "today") {
    value = "today";
    rangeLabel = "today";
    range = { from: startOfDay(now, local), to: endOfDay(now, local) };
  } else if (query.range === "month") {
    value = "month";
    rangeLabel = "this month";
    range = { from: startOfMonth(now, local), to: endOfMonth(now, local) };
  } else if (query.range === "custom") {
    if (
      typeof query.from !== "string" ||
      typeof query.to !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(query.from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(query.to)
    )
      throw new AppError("validation", "Pick From and To dates.");
    value = "custom";
    range = {
      from: startOfDay(parseISO(query.from, local), local),
      to: endOfDay(parseISO(query.to, local), local),
    };
    rangeLabel = `${query.from} to ${query.to}`;
  }
  const [overview, queue, members] = await Promise.all([
    getTeamOverview(ctx, range),
    listLeads(ctx, { assignedTo: "unassigned" }),
    listMembers(ctx),
  ]);
  const people = overview.perMember;
  const a =
    typeof query.a === "string" &&
    people.some((person) => person.memberId === query.a)
      ? query.a
      : (people[0]?.memberId ?? "");
  const b =
    typeof query.b === "string" &&
    query.b !== a &&
    people.some((person) => person.memberId === query.b)
      ? query.b
      : (people.find((person) => person.memberId !== a)?.memberId ?? "");
  const [metrics, dashboards] = await Promise.all([
    a && b ? compareMembers(ctx, { ...range, a, b }) : null,
    Promise.all(
      people.map(
        async (person) =>
          [
            person.memberId,
            <MemberPanel
              key={person.memberId}
              member={person}
              dashboard={
                await getMemberDashboard(ctx, {
                  memberId: person.memberId,
                  ...range,
                })
              }
            />,
          ] as const,
      ),
    ),
  ]);
  return (
    <PageShell wide className="space-y-6 lg:pb-10">
      <h1 className="font-display text-3xl font-bold lg:text-4xl">Dashboard</h1>
      <Tiles tiles={overview.tiles} slug={slug} />
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <RangePicker
            key={`${value}/${range.from.toISOString()}/${range.to.toISOString()}`}
            value={value}
            from={format(range.from, "yyyy-MM-dd", local)}
            to={format(range.to, "yyyy-MM-dd", local)}
          />
          <TeamTable
            key={slug}
            members={people}
            panels={Object.fromEntries(dashboards)}
            rangeLabel={rangeLabel}
          />
          <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
            <Funnel funnel={overview.funnel} />
            <Compare
              members={people}
              a={a}
              b={b}
              metrics={metrics}
              rangeLabel={rangeLabel}
            />
          </div>
        </div>
        <aside
          id="unassigned"
          aria-label="Unassigned leads"
          className="hidden min-w-0 space-y-3 rounded-2xl border border-line bg-surface p-4 lg:block"
        >
          <h2 className="font-display text-xl font-bold">Unassigned</h2>
          <AssignList
            key={`${slug}/${ctx.user.id}`}
            compact
            items={queue.items}
            members={members.filter((member) => member.status === "active")}
            total={queue.total}
            nextCursor={queue.nextCursor}
          />
        </aside>
      </div>
    </PageShell>
  );
}
