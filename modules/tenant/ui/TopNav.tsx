import Link from "next/link";
import type { Ctx } from "../types";

export function TopNav({
  ctx,
  companyName,
}: {
  ctx: Ctx;
  companyName: string;
}) {
  return (
    <header className="border-b border-line bg-surface px-4">
      <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-2 py-2">
        <div className="min-w-0">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center font-display text-2xl font-bold text-brand"
          >
            Anar
          </Link>
          <p className="truncate text-sm text-muted">{companyName}</p>
        </div>
        <div className="flex items-center gap-4">
          {ctx.role === "dna" && (
            <nav aria-label="Main navigation" className="hidden lg:block">
              <Link
                href="/companies"
                className="inline-flex min-h-11 items-center font-semibold text-brand"
              >
                Companies
              </Link>
            </nav>
          )}
          <span className="text-sm text-muted">{ctx.user.name}</span>
        </div>
      </div>
    </header>
  );
}
