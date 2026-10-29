import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageShell } from "@/components/PageShell";
import { formatDay } from "@/lib/dates";
import { can, homeFor, requireDemoContext } from "@/modules/tenant/server";
import { listCompanies } from "../server";
import { EnterCompanyButton } from "./EnterCompanyButton";

export async function CompaniesPage() {
  const ctx = await requireDemoContext();
  if (!can(ctx, "company.list")) redirect(homeFor(ctx));
  const companies = await listCompanies();
  return (
    <PageShell className="lg:max-w-7xl">
      <header className="mb-6">
        <p className="text-sm text-muted">Anar · DNA</p>
        <h1 className="font-display text-3xl font-bold">Companies</h1>
        <p className="mt-2 text-muted">
          Choose the company you want to work in.
        </p>
      </header>
      {companies.length === 0 && <EmptyState title="No companies yet" />}
      <div className="space-y-4">
        {companies.length > 0 && (
          <div className="hidden items-center gap-4 px-5 text-sm font-semibold text-muted lg:grid lg:grid-cols-[minmax(0,2fr)_7rem_5rem_5rem_9rem_12rem]">
            <span>Company</span>
            <span>Status</span>
            <span>Members</span>
            <span>Leads</span>
            <span>Last import</span>
            <span>Open</span>
          </div>
        )}
        {companies.map((company) => (
          <article
            key={company.id}
            className="grid min-w-0 gap-2 rounded-2xl border border-line bg-surface p-5 lg:grid-cols-[minmax(0,2fr)_7rem_5rem_5rem_9rem_12rem] lg:items-center lg:gap-4"
          >
            <h2 className="min-w-0 font-display text-xl font-semibold wrap-break-word">
              {company.name}
            </h2>
            <p className="text-sm text-muted capitalize">
              <span className="lg:hidden">Status: </span>
              {company.status}
            </p>
            <p className="text-sm text-muted">
              {company.memberCount}
              <span className="lg:hidden"> team members</span>
            </p>
            <p className="text-sm text-muted">
              {company.leadCount}
              <span className="lg:hidden"> leads</span>
            </p>
            <p className="mb-2 text-sm text-muted lg:mb-0">
              <span className="lg:hidden">Last import: </span>
              {company.lastImportAt === null
                ? "No imports yet"
                : formatDay(company.lastImportAt)}
            </p>
            <EnterCompanyButton
              companyId={company.id}
              disabled={company.status !== "active"}
            />
          </article>
        ))}
      </div>
    </PageShell>
  );
}
