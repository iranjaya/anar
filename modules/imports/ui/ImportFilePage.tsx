import { redirect } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { listCompanies } from "@/modules/companies/server";
import { can, homeFor, requireContext } from "@/modules/tenant/server";
import { FileCard } from "./FileCard";
import { ImportRail } from "./ImportRail";

export async function ImportFilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await requireContext(slug);
  if (!can(ctx, "imports.upload")) redirect(homeFor(ctx));
  const companies = await listCompanies();
  return (
    <PageShell wide>
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold">Import leads</h1>
        <p className="mt-2 text-muted">Bring in your Meta lead export.</p>
      </header>
      <div className="min-w-0 lg:flex lg:gap-8">
        <ImportRail step={1} />
        <div className="min-w-0 flex-1">
          <FileCard
            key={ctx.companyId}
            companyId={ctx.companyId}
            slug={slug}
            companies={companies}
          />
        </div>
      </div>
    </PageShell>
  );
}
