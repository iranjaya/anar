import Link from "next/link";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { ReadError } from "@/components/ReadError";
import { getSession, listWorkspaces } from "../server";
import { LogoutButton } from "./LogoutButton";

async function readSession() {
  const result = await getSession();
  if (!result || (!result.ok && result.error === "unauthorized"))
    redirect("/login");
  return result;
}

function AccountLinks() {
  return (
    <nav
      aria-label="Account navigation"
      className="mb-6 flex flex-wrap items-center gap-5"
    >
      <Link
        href="/workspaces"
        className="inline-flex min-h-11 items-center font-semibold text-brand"
      >
        Workspaces
      </Link>
      <Link
        href="/account/sessions"
        className="inline-flex min-h-11 items-center font-semibold text-brand"
      >
        Your devices
      </Link>
      <LogoutButton />
    </nav>
  );
}

export async function SessionHomePage() {
  const result = await readSession();
  if (result.ok) redirect(result.data.redirectTo);
  return (
    <PageShell>
      <ReadError message={result.message} href="/" />
    </PageShell>
  );
}

export async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (!session.ok)
    return (
      <PageShell>
        <ReadError message={session.message} href="/workspaces" />
      </PageShell>
    );
  if (session.data.redirectTo !== "/workspaces")
    redirect(session.data.redirectTo);
  const { cursor } = await searchParams;
  const page = await listWorkspaces(cursor === undefined ? {} : { cursor });
  return (
    <PageShell wide>
      <AccountLinks />
      <h1 className="font-display text-3xl font-bold">Your workspaces</h1>
      <p className="mb-6 mt-2 text-muted">
        Choose the company you want to work in.
      </p>
      {page && !page.ok && (
        <ReadError message={page.message} href="/workspaces" />
      )}
      {page?.ok && (
        <>
          {page.data.items.length === 0 && (
            <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
              No workspaces on this page.
            </p>
          )}
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            {page.data.items.map((company) => (
              <Link
                key={company.id}
                href={`/${company.slug}`}
                className="min-w-0 rounded-2xl border border-line bg-surface p-6 focus-visible:outline-2 focus-visible:outline-brand"
              >
                <h2 className="font-display text-xl font-semibold wrap-break-word">
                  {company.name}
                </h2>
                <p className="mt-2 text-sm text-muted wrap-break-word">
                  {company.slug}
                </p>
                <p className="mt-4 font-semibold text-brand">Open company →</p>
              </Link>
            ))}
          </div>
          <nav
            aria-label="Workspace pages"
            className="mt-6 flex flex-wrap gap-6"
          >
            {cursor !== undefined && (
              <Link
                href="/workspaces"
                className="inline-flex min-h-11 items-center font-semibold text-brand"
              >
                Newest
              </Link>
            )}
            {page.data.nextCursor && (
              <Link
                href={`/workspaces?cursor=${encodeURIComponent(page.data.nextCursor)}`}
                className="inline-flex min-h-11 items-center font-semibold text-brand"
              >
                Older
              </Link>
            )}
          </nav>
        </>
      )}
    </PageShell>
  );
}

export async function AccountPage() {
  const result = await readSession();
  if (!result.ok) return <ReadError message={result.message} href="/account" />;
  return (
    <>
      <p className="text-sm font-semibold text-brand">Your account</p>
      <h1 className="mt-2 font-display text-3xl font-bold">
        {result.data.workspace.kind === "none"
          ? "No workspace access"
          : "Signed in"}
      </h1>
      <p className="mt-4 wrap-break-word">{result.data.user.name}</p>
      <p className="mt-1 text-sm text-muted wrap-break-word">
        {result.data.user.email}
      </p>
      <p className="my-5 text-muted">
        {result.data.workspace.kind === "none"
          ? "Ask your agency or company administrator for access, or sign out to use a different email."
          : "Manage your signed-in devices or return to your workspace."}
      </p>
      <AccountLinks />
    </>
  );
}
