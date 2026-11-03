import { notFound } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { ReadError } from "@/components/ReadError";
import { listTeam } from "@/modules/members/server";
import { getCompanyContext } from "@/modules/tenant/server";
import { listLeadQueue } from "../data/queue";
import { assignLeadsRealAction } from "../editActions";
import { AssignList } from "./AssignList";

export async function LeadQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    q?: string | string[];
    priority?: string | string[];
    cursor?: string | string[];
  }>;
}) {
  const { slug } = await params;
  const context = await getCompanyContext(slug);
  if (!context?.ok || !context.data.capabilities.includes("leads.view"))
    notFound();
  const own = context.data.role === "admin";
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q : undefined;
  const cursor = typeof query.cursor === "string" ? query.cursor : undefined;
  const priority =
    query.priority === "hot" ||
    query.priority === "warm" ||
    query.priority === "cold"
      ? query.priority
      : undefined;
  const filtered = Boolean(q || priority || cursor);
  const canAssign = context.data.capabilities.includes("leads.assign");
  const [queue, page, team] = await Promise.all([
    listLeadQueue(slug, {}),
    filtered ? listLeadQueue(slug, { q, priority, cursor }) : null,
    canAssign ? listTeam(slug) : null,
  ]);
  const shown = filtered ? page : queue;
  return (
    <PageShell wide className="lg:pb-10">
      <h1 className="mb-2 font-display text-3xl font-bold lg:text-4xl">
        {own ? "My leads" : "Unassigned leads"}
      </h1>
      {queue?.ok && shown?.ok ? (
        <AssignList
          key={`${slug}/${context.data.user.id}`}
          items={shown.data.items}
          timezone={context.data.company.timezone}
          members={
            team?.ok
              ? team.data.filter((member) => member.status === "active")
              : []
          }
          total={queue.data.total}
          nextCursor={shown.data.nextCursor}
          q={q}
          priority={priority}
          noun={own ? "leads assigned to you" : "unassigned leads"}
          assignNote={assignNote(own, team)}
          assignAction={team?.ok ? assignLeadsRealAction : undefined}
        />
      ) : (
        <ReadError
          message={
            (queue?.ok === false && queue.message) ||
            (shown?.ok === false && shown.message) ||
            "Leads could not be loaded."
          }
          href={`/${slug}/leads`}
        />
      )}
    </PageShell>
  );
}

function assignNote(
  own: boolean,
  team: Awaited<ReturnType<typeof listTeam>>,
): string | undefined {
  if (own) return "Your manager assigns leads.";
  if (!team?.ok)
    return "The team could not be loaded, so leads cannot be assigned right now.";
  return undefined;
}
