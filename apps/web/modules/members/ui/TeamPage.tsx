import { notFound } from "next/navigation";
import { ReadError } from "@/components/ReadError";
import { formatClock, formatDay } from "@/lib/dates";
import { getCompanyContext } from "@/modules/tenant/server";
import { listAgencyEntries, listPendingInvites, listTeam } from "../server";
import { InviteAdmin } from "./InviteAdmin";
import { RemoveMember } from "./RemoveMember";
import { ResendInvite } from "./ResendInvite";

export async function TeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getCompanyContext(slug);
  if (!context?.ok || !context.data.capabilities.includes("members.list"))
    notFound();
  const [team, invites, entries] = await Promise.all([
    listTeam(slug),
    listPendingInvites(slug),
    listAgencyEntries(slug),
  ]);
  const href = `/${slug}/settings/team`;
  const canInvite = context.data.capabilities.includes("members.invite_admin");
  const canRemove = context.data.capabilities.includes("members.deactivate");
  const staff = context.data.role === "agency_staff";
  const active = team?.ok
    ? team.data.filter((member) => member.status === "active").length
    : 0;
  return (
    <section className="min-w-0">
      <h1 className="font-display text-3xl font-bold">Team</h1>
      <p className="mt-2 text-muted wrap-break-word">
        {context.data.company.name}
      </p>
      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section aria-labelledby="members-heading" className="min-w-0">
          <h2
            id="members-heading"
            className="font-display text-xl font-semibold"
          >
            Members
          </h2>
          {!team?.ok ? (
            <div className="mt-3">
              <ReadError
                message={team?.message ?? "The team could not be loaded."}
                href={href}
              />
            </div>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">
                {active === 1 ? "1 active member" : `${active} active members`}
              </p>
              {team.data.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-line bg-surface p-6 text-muted">
                  No team members yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {team.data.map((member) => (
                    <li
                      key={member.id}
                      className="grid min-w-0 gap-1 rounded-2xl border border-line bg-surface p-5 lg:grid-cols-[minmax(0,1fr)_10rem_7rem] lg:items-center lg:gap-4"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold wrap-break-word">
                          {member.name}
                        </p>
                        <p className="text-sm text-muted wrap-break-word">
                          {member.email}
                        </p>
                      </div>
                      <p className="text-sm capitalize">
                        {member.role.replaceAll("_", " ")}
                      </p>
                      <p className="text-sm text-muted capitalize">
                        {member.status}
                      </p>
                      {canRemove &&
                        (staff || member.role === "admin") &&
                        member.status === "active" && (
                          <RemoveMember
                            slug={slug}
                            memberId={member.id}
                            name={member.name}
                          />
                        )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
        <section aria-labelledby="invites-heading" className="min-w-0">
          <h2
            id="invites-heading"
            className="font-display text-xl font-semibold"
          >
            Pending invites
          </h2>
          {!invites?.ok ? (
            <div className="mt-3">
              <ReadError
                message={invites?.message ?? "Invites could not be loaded."}
                href={href}
              />
            </div>
          ) : invites.data.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
              No pending invites.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {invites.data.map((invite) => (
                <li
                  key={invite.id}
                  className="min-w-0 rounded-2xl border border-line bg-surface p-5"
                >
                  <p className="font-semibold wrap-break-word">{invite.name}</p>
                  <p className="text-sm text-muted wrap-break-word">
                    {invite.email}
                  </p>
                  <p className="mt-2 text-sm capitalize">
                    {invite.role.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Expires{" "}
                    <time dateTime={invite.expiresAt.toISOString()}>
                      {formatDay(invite.expiresAt)}
                    </time>
                  </p>
                  {canInvite && (staff || invite.role === "admin") && (
                    <ResendInvite slug={slug} inviteId={invite.id} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        {canInvite && (
          <div className="min-w-0 lg:col-start-2">
            <InviteAdmin slug={slug} />
          </div>
        )}
        <section
          aria-labelledby="entries-heading"
          className="min-w-0 lg:col-start-1"
        >
          <h2
            id="entries-heading"
            className="font-display text-xl font-semibold"
          >
            Agency staff entries
          </h2>
          <p className="mt-1 text-sm text-muted">
            The last 30 times agency staff opened this company.
          </p>
          {!entries?.ok ? (
            <div className="mt-3">
              <ReadError
                message={entries?.message ?? "Entries could not be loaded."}
                href={href}
              />
            </div>
          ) : entries.data.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
              No agency staff entries yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {entries.data.map((entry) => (
                <li
                  key={entry.id}
                  className="min-w-0 rounded-2xl border border-line bg-surface p-5"
                >
                  <p className="font-semibold wrap-break-word">
                    {entry.staffName}
                  </p>
                  <p className="mt-1 text-sm wrap-break-word">{entry.reason}</p>
                  <p className="mt-1 text-xs text-muted">
                    <time dateTime={entry.enteredAt.toISOString()}>
                      {formatDay(entry.enteredAt)},{" "}
                      {formatClock(entry.enteredAt)}
                    </time>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
