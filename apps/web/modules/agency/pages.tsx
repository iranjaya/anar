import Link from "next/link";
import {
  getAgency,
  getAgencyReadiness,
  listInvites,
  listStaff,
} from "./server";
import { AgencyFrame } from "./ui/AgencyFrame";
import { InviteColleague } from "./ui/InviteColleague";
import { PageLinks } from "./ui/PageLinks";
import { RemoveStaff } from "./ui/RemoveStaff";
import { ResendInvite } from "./ui/ResendInvite";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function AgencyOverviewPage() {
  const result = await getAgency();
  return (
    <AgencyFrame
      title="Your agency"
      active="/agency"
      result={result}
      readiness={getAgencyReadiness()}
    >
      {result?.ok ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="font-display text-xl font-semibold wrap-break-word">
              {result.data.agency.name}
            </h2>
            <p className="mt-2 text-sm text-muted wrap-break-word">
              {result.data.agency.slug}
            </p>
            <p className="mt-3 capitalize">{result.data.agency.status}</p>
            <p className="mt-2 text-sm text-muted">
              Created{" "}
              <time dateTime={result.data.agency.createdAt.toISOString()}>
                {result.data.agency.createdAt.toISOString().slice(0, 10)} UTC
              </time>
            </p>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="font-display text-xl font-semibold">
              Your membership
            </h2>
            <p className="mt-3 wrap-break-word">{result.data.staff.name}</p>
            <p className="mt-1 text-sm text-muted wrap-break-word">
              {result.data.staff.email}
            </p>
            <p className="mt-2 text-sm capitalize">
              {result.data.staff.status}
            </p>
            <Link
              href="/agency/staff"
              className="mt-3 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
            >
              View agency staff
            </Link>
          </section>
        </div>
      ) : (
        <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
          Your agency and membership details will appear here when access is
          available.
        </p>
      )}
    </AgencyFrame>
  );
}

export async function AgencyStaffPage({ searchParams }: PageProps) {
  const result = await getAgency();
  const readiness = getAgencyReadiness();
  const { cursor } = await searchParams;
  const canList = !!(
    result?.ok && result.data.capabilities.includes("agency.staff.list")
  );
  const page = canList
    ? await listStaff(cursor === undefined ? {} : { cursor })
    : null;
  const canInvite = !!(
    readiness.enabled &&
    result?.ok &&
    result.data.capabilities.includes("agency.staff.invite")
  );
  const canRemove = !!(
    readiness.enabled &&
    result?.ok &&
    result.data.capabilities.includes("agency.staff.deactivate")
  );
  const selfId = result?.ok ? result.data.staff.id : null;
  return (
    <AgencyFrame
      title="Agency staff"
      active="/agency/staff"
      result={result}
      readiness={readiness}
    >
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section aria-label="Staff list" className="min-w-0 space-y-4">
          {!page && (
            <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
              Staff information is currently unavailable. No staff have been
              loaded.
            </p>
          )}
          {page && !page.ok && (
            <div
              role="alert"
              className="rounded-2xl border border-line bg-surface p-5"
            >
              <p className="text-overdue">{page.message}</p>
              <Link
                href="/agency/staff"
                className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
              >
                Reload staff
              </Link>
            </div>
          )}
          {page?.ok && page.data.items.length === 0 && (
            <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
              No staff on this page.
            </p>
          )}
          {page?.ok &&
            page.data.items.map((member) => (
              <article
                key={member.id}
                className="grid min-w-0 gap-3 rounded-2xl border border-line bg-surface p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-semibold wrap-break-word">
                    {member.name}
                  </h2>
                  <p className="mt-1 text-sm text-muted wrap-break-word">
                    {member.email}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    Joined{" "}
                    <time dateTime={member.createdAt.toISOString()}>
                      {member.createdAt.toISOString().slice(0, 10)} UTC
                    </time>
                  </p>
                </div>
                <div className="flex flex-col gap-2 lg:items-end">
                  <p className="text-sm capitalize">{member.status}</p>
                  {canRemove && member.status === "active" && (
                    <RemoveStaff
                      staffId={member.id}
                      name={member.name}
                      self={member.id === selfId}
                    />
                  )}
                </div>
              </article>
            ))}
          {page?.ok && (
            <PageLinks
              path="/agency/staff"
              hasCursor={cursor !== undefined}
              nextCursor={page.data.nextCursor}
            />
          )}
        </section>
        <InviteColleague enabled={canInvite} />
      </div>
    </AgencyFrame>
  );
}

export async function AgencyInvitesPage({ searchParams }: PageProps) {
  const result = await getAgency();
  const readiness = getAgencyReadiness();
  const { cursor } = await searchParams;
  const canList = !!(
    result?.ok && result.data.capabilities.includes("agency.staff.list")
  );
  const page = canList
    ? await listInvites(cursor === undefined ? {} : { cursor })
    : null;
  const canResend = !!(
    readiness.enabled &&
    result?.ok &&
    result.data.capabilities.includes("agency.staff.resend")
  );
  const now = Date.now();
  return (
    <AgencyFrame
      title="Pending invitations"
      active="/agency/invites"
      result={result}
      readiness={readiness}
    >
      <section aria-label="Pending invitations" className="space-y-4">
        <p className="text-sm text-muted">
          Invitations awaiting acceptance, including expired links. Resending
          needs a fresh code.
        </p>
        {!page && (
          <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
            Invitations are currently unavailable. No invitations have been
            loaded.
          </p>
        )}
        {page && !page.ok && (
          <div
            role="alert"
            className="rounded-2xl border border-line bg-surface p-5"
          >
            <p className="text-overdue">{page.message}</p>
            <Link
              href="/agency/invites"
              className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
            >
              Reload invitations
            </Link>
          </div>
        )}
        {page?.ok && page.data.items.length === 0 && (
          <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
            No pending invitations on this page.
          </p>
        )}
        {page?.ok &&
          page.data.items.map((invite) => (
            <article
              key={invite.id}
              className="grid min-w-0 gap-4 rounded-2xl border border-line bg-surface p-5 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,24rem)] lg:items-start"
            >
              <div className="min-w-0">
                <h2 className="font-display text-xl font-semibold wrap-break-word">
                  {invite.name}
                </h2>
                <p className="mt-1 text-sm text-muted wrap-break-word">
                  {invite.email}
                </p>
                <p className="mt-2 text-sm">
                  {invite.expiresAt.getTime() <= now
                    ? "Expired"
                    : "Awaiting acceptance"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Expiry:{" "}
                  <time dateTime={invite.expiresAt.toISOString()}>
                    {invite.expiresAt
                      .toISOString()
                      .replace("T", " ")
                      .slice(0, 16)}{" "}
                    UTC
                  </time>
                </p>
              </div>
              <ResendInvite inviteId={invite.id} enabled={canResend} />
            </article>
          ))}
        {page?.ok && (
          <PageLinks
            path="/agency/invites"
            hasCursor={cursor !== undefined}
            nextCursor={page.data.nextCursor}
          />
        )}
      </section>
    </AgencyFrame>
  );
}
