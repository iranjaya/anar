import { redirect } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { listMembers } from "@/modules/members/server";
import { can, homeFor, requireContext } from "@/modules/tenant/server";
import { listLeads } from "../server";
import { AssignList } from "./AssignList";

export async function UnassignedPage({
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
  const ctx = await requireContext(slug);
  if (!can(ctx, "leads.assign")) redirect(homeFor(ctx));
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q : undefined;
  const cursor = typeof query.cursor === "string" ? query.cursor : undefined;
  const priority =
    query.priority === "hot" ||
    query.priority === "warm" ||
    query.priority === "cold"
      ? query.priority
      : undefined;
  const [queue, members] = await Promise.all([
    listLeads(ctx, { assignedTo: "unassigned" }),
    listMembers(ctx),
  ]);
  const filtered =
    q || priority || cursor
      ? await listLeads(ctx, { assignedTo: "unassigned", q, priority, cursor })
      : queue;
  return (
    <PageShell wide className="lg:pb-10">
      <h1 className="mb-2 font-display text-3xl font-bold lg:text-4xl">
        Unassigned leads
      </h1>
      <AssignList
        key={`${slug}/${ctx.user.id}`}
        items={filtered.items}
        members={members.filter((member) => member.status === "active")}
        total={queue.total}
        nextCursor={filtered.nextCursor}
        q={q}
        priority={priority}
      />
    </PageShell>
  );
}
