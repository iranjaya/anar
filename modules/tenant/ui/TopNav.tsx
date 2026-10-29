import Link from "next/link";
import type { Ctx } from "../types";

export function TopNav({
  ctx,
  companyName,
}: {
  ctx: Ctx;
  companyName: string;
}) {
  const links = [];
  if (ctx.role === "dna") {
    links.push(
      { href: "/companies", label: "Companies" },
      { href: `/${ctx.companyId}/imports/new`, label: "Import" },
    );
  } else if (ctx.role === "super_admin") {
    links.push(
      { href: `/${ctx.companyId}/dashboard`, label: "Dashboard" },
      { href: `/${ctx.companyId}/leads`, label: "Leads" },
    );
  }

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
          {links.length > 0 && (
            <nav aria-label="Main navigation" className="hidden gap-4 lg:flex">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="inline-flex min-h-11 items-center font-semibold text-brand"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          )}
          <span className="text-sm text-muted">{ctx.user.name}</span>
        </div>
      </div>
    </header>
  );
}
