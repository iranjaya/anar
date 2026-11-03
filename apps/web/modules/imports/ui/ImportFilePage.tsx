import { redirect } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { dataMode } from "@/lib/api/mode";
import { listCompanies } from "@/modules/companies/server";
import {
  can,
  getCompanyShell,
  hasCapability,
  homeFor,
  requireFeatureContext,
} from "@/modules/tenant/server";
import { getRealUploadResult } from "../server";
import { FileCard } from "./FileCard";
import { ImportRail } from "./ImportRail";

export async function ImportFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ batch?: string }>;
}) {
  const { slug } = await params;
  return (
    <PageShell wide>
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold">Import leads</h1>
        <p className="mt-2 text-muted">Bring in your Meta lead export.</p>
      </header>
      <div className="min-w-0 lg:flex lg:gap-8">
        <ImportRail step={1} />
        <div className="min-w-0 flex-1">
          {dataMode() === "real"
            ? await realCard(slug, (await searchParams).batch)
            : await demoCard(slug)}
        </div>
      </div>
    </PageShell>
  );
}

async function realCard(slug: string, batchId: string | undefined) {
  const view = await requireFeatureContext(slug);
  if (!("capabilities" in view) || !hasCapability(view, "imports.upload"))
    redirect(`/${slug}`);
  const initial = batchId ? await getRealUploadResult(slug, batchId) : null;
  return (
    <FileCard
      key={view.companyId}
      mode="real"
      slug={slug}
      timezone={view.company.timezone}
      companyName={view.company.name}
      canChangeCompany={view.role === "agency_staff"}
      initial={initial}
    />
  );
}

async function demoCard(slug: string) {
  const { ctx, company } = await getCompanyShell(slug);
  if (!can(ctx, "imports.upload")) redirect(homeFor(ctx));
  const companies = await listCompanies();
  return (
    <FileCard
      key={ctx.companyId}
      mode="demo"
      slug={slug}
      timezone={company.timezone}
      companyId={ctx.companyId}
      companies={companies}
    />
  );
}
