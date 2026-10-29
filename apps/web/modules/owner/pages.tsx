import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { getOwnerReadiness, listAgencies } from "./server";
import { CreateAgencyForm } from "./ui/CreateAgencyForm";
import { ResendFirstInvite } from "./ui/ResendFirstInvite";

export async function AgenciesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const readiness = getOwnerReadiness();
  const { cursor } = await searchParams;
  const result = await listAgencies(cursor === undefined ? {} : { cursor });
  return (
    <PageShell wide>
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-brand">Anar · Owner</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Agencies</h1>
          <p className="mt-2 text-muted">
            Create agencies and invite their first staff member.
          </p>
        </div>
        <Link
          href="/account/sessions"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4"
        >
          Your devices
        </Link>
      </header>
      {!readiness.enabled && (
        <p
          role="status"
          className="mb-6 rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand"
        >
          {readiness.message}
        </p>
      )}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section aria-label="Agency list" className="min-w-0 space-y-4">
          {result && !result.ok && (
            <div
              role="alert"
              className="rounded-xl border border-line bg-surface p-5"
            >
              <p className="text-overdue">{result.message}</p>
              <Link
                href="/owner/agencies"
                className="mt-2 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
              >
                Reload agencies
              </Link>
            </div>
          )}
          {!result && (
            <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
              Agency details will appear here when owner access is available.
            </div>
          )}
          {result?.ok && result.data.items.length === 0 && (
            <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
              No agencies on this page.
            </p>
          )}
          {result?.ok &&
            result.data.items.map((agency) => (
              <article
                key={agency.id}
                className="grid min-w-0 gap-4 rounded-2xl border border-line bg-surface p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-semibold wrap-break-word">
                    {agency.name}
                  </h2>
                  <p className="mt-1 text-sm text-muted wrap-break-word">
                    {agency.slug}
                  </p>
                  <p className="mt-2 text-sm capitalize">{agency.status}</p>
                  <p className="mt-1 text-xs text-muted">
                    Created{" "}
                    <time dateTime={agency.createdAt.toISOString()}>
                      {agency.createdAt.toISOString().slice(0, 10)} UTC
                    </time>
                  </p>
                </div>
                {agency.status === "pending" && (
                  <ResendFirstInvite
                    agencyId={agency.id}
                    enabled={readiness.enabled}
                  />
                )}
              </article>
            ))}
          {result?.ok && (
            <nav aria-label="Agency pages" className="flex flex-wrap gap-6">
              {cursor && (
                <Link
                  href="/owner/agencies"
                  className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
                >
                  Newest agencies
                </Link>
              )}
              {result.data.nextCursor && (
                <Link
                  href={`/owner/agencies?cursor=${encodeURIComponent(result.data.nextCursor)}`}
                  className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
                >
                  Older agencies
                </Link>
              )}
            </nav>
          )}
        </section>
        <CreateAgencyForm enabled={readiness.enabled} />
      </div>
    </PageShell>
  );
}
