import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageShell } from "@/components/PageShell";
import { can, homeFor, requireDemoContext } from "@/modules/tenant/server";
import { listCompanies } from "../server";
import { EnterCompanyButton } from "./EnterCompanyButton";

export async function CompaniesPage() {
  const ctx = await requireDemoContext();
  if (!can(ctx, "company.list")) redirect(homeFor(ctx));
  const companies = await listCompanies();
  return (
    <PageShell>
      <header className="mb-6">
        <p className="text-sm text-muted">Anar · DNA</p>
        <h1 className="font-display text-3xl font-bold">Companies</h1>
        <p className="mt-2 text-muted">
          Choose the company you want to work in.
        </p>
      </header>
      {companies.length === 0 && <EmptyState title="No companies yet" />}
      <div className="space-y-4">
        {companies.map((company) => (
          <article
            key={company.id}
            className="rounded-2xl border border-line bg-surface p-5"
          >
            <h2 className="font-display text-xl font-semibold">
              {company.name}
            </h2>
            <p className="mt-2 mb-4 text-sm text-muted">
              {company.memberCount} team members · {company.leadCount} leads
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
