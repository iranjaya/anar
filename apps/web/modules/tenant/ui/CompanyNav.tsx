import type { ContextView } from "@anar/domain/context";
import Link from "next/link";
import { LogoutButton } from "@/modules/auth/components";

export function CompanyNav({ view }: { view: ContextView }) {
  return (
    <header className="border-b border-line bg-surface px-4">
      <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-2 py-2">
        <div className="min-w-0">
          <Link
            href={`/${view.company.slug}`}
            className="inline-flex min-h-11 items-center font-display text-2xl font-bold text-brand"
          >
            Anar
          </Link>
          <p className="truncate text-sm text-muted">
            {view.company.name} · {view.agency.name}
          </p>
        </div>
        <nav
          aria-label="Main navigation"
          className="flex flex-wrap items-center gap-x-4"
        >
          {view.capabilities.includes("members.list") && (
            <Link
              href={`/${view.company.slug}/settings/team`}
              className="inline-flex min-h-11 items-center font-semibold text-brand"
            >
              Team
            </Link>
          )}
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
          <span className="text-sm text-muted">{view.user.name}</span>
        </nav>
      </div>
    </header>
  );
}
