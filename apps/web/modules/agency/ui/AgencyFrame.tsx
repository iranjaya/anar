import type { AgencyView } from "@anar/domain/agencies";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageShell } from "@/components/PageShell";
import type { ActionResult } from "@/lib/errors";

export function AgencyFrame({
  title,
  active,
  result,
  readiness,
  children,
}: {
  title: string;
  active: "/agency" | "/agency/staff" | "/agency/invites" | "/agency/companies";
  result: ActionResult<AgencyView> | null;
  readiness: { enabled: boolean; message: string };
  children: ReactNode;
}) {
  return (
    <PageShell wide>
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-brand">Anar · Agency</p>
          <h1 className="mt-2 font-display text-3xl font-bold">{title}</h1>
          {result?.ok && (
            <p className="mt-2 text-muted wrap-break-word">
              {result.data.agency.name}
            </p>
          )}
        </div>
        <Link
          href="/account/sessions"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4"
        >
          Your devices
        </Link>
      </header>
      <nav
        aria-label="Agency navigation"
        className="mb-6 flex flex-wrap gap-2 rounded-xl border border-line bg-surface p-2"
      >
        {[
          ["/agency", "Overview"],
          ["/agency/companies", "Companies"],
          ["/agency/staff", "Staff"],
          ["/agency/invites", "Pending invites"],
        ].map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={active === href ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold ${active === href ? "bg-brand-soft text-brand" : "text-muted"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {!readiness.enabled && (
        <p
          role="status"
          className="mb-6 rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand"
        >
          {readiness.message}
        </p>
      )}
      {result && !result.ok && (
        <div
          role="alert"
          className="rounded-xl border border-line bg-surface p-5"
        >
          <p className="text-overdue">{result.message}</p>
          <Link
            href={active}
            className="mt-2 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
          >
            Try again
          </Link>
        </div>
      )}
      {(!readiness.enabled || result?.ok) && children}
    </PageShell>
  );
}
