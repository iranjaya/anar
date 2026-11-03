import Link from "next/link";
import { formatDay } from "@/lib/dates";
import { AgencyFrame, PageLinks } from "@/modules/agency/components";
import { getAgency } from "@/modules/agency/server";
import { getCompanyReadiness, listAgencyCompanies } from "../server";
import { CreateCompany } from "./CreateCompany";
import { EnterAgencyCompany } from "./EnterAgencyCompany";
import { InviteSuperAdmin } from "./InviteSuperAdmin";

export async function AgencyCompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const readiness = getCompanyReadiness();
  const agency = readiness.enabled ? await getAgency() : null;
  const capabilities = agency?.ok ? agency.data.capabilities : [];
  const { cursor } = await searchParams;
  const page = capabilities.includes("company.list")
    ? await listAgencyCompanies(cursor === undefined ? {} : { cursor })
    : null;
  const canInvite =
    readiness.enabled && capabilities.includes("members.invite_super_admin");
  const canEnter = readiness.enabled && capabilities.includes("company.enter");
  return (
    <AgencyFrame
      title="Agency companies"
      active="/agency/companies"
      result={agency}
      readiness={readiness}
    >
      <p className="mb-6 text-muted">
        Create and manage companies in your agency.
      </p>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section aria-label="Company list" className="min-w-0 space-y-4">
          {!page && (
            <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
              Company information is currently unavailable. No companies have
              been loaded.
            </p>
          )}
          {page && !page.ok && (
            <div
              role="alert"
              className="rounded-2xl border border-line bg-surface p-5"
            >
              <p className="text-overdue">{page.message}</p>
              <Link
                href="/agency/companies"
                className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
              >
                Reload companies
              </Link>
            </div>
          )}
          {page?.ok && page.data.items.length === 0 && (
            <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
              No companies on this page.
            </p>
          )}
          {page?.ok && page.data.items.length > 0 && (
            <div className="hidden gap-3 px-5 text-xs font-semibold text-muted lg:grid lg:grid-cols-[minmax(0,2fr)_5rem_4rem_4rem_7rem]">
              <span>Company</span>
              <span>Status</span>
              <span>Members</span>
              <span>Leads</span>
              <span>Last import</span>
            </div>
          )}
          {page?.ok &&
            page.data.items.map((company) => (
              <article
                key={company.id}
                className="min-w-0 rounded-2xl border border-line bg-surface p-5"
              >
                <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,2fr)_5rem_4rem_4rem_7rem] lg:items-center lg:gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-xl font-semibold wrap-break-word">
                      {company.name}
                    </h2>
                    <p className="mt-1 text-xs text-muted wrap-break-word">
                      {company.slug}
                    </p>
                  </div>
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
                  <p className="text-sm text-muted">
                    <span className="lg:hidden">Last import: </span>
                    {company.lastImportAt === null
                      ? "No imports yet"
                      : formatDay(company.lastImportAt, company.timezone)}
                  </p>
                </div>
                {canEnter && company.status === "active" && (
                  <EnterAgencyCompany
                    companyId={company.id}
                    slug={company.slug}
                    name={company.name}
                  />
                )}
                {company.memberCount === 0 && company.status === "active" && (
                  <InviteSuperAdmin
                    companyId={company.id}
                    enabled={canInvite}
                  />
                )}
              </article>
            ))}
          {page?.ok && (
            <PageLinks
              path="/agency/companies"
              hasCursor={cursor !== undefined}
              nextCursor={page.data.nextCursor}
            />
          )}
        </section>
        <CreateCompany
          enabled={readiness.enabled && capabilities.includes("company.create")}
          canInvite={canInvite}
        />
      </div>
    </AgencyFrame>
  );
}
