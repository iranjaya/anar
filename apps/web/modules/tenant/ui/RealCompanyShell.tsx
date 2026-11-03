import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PageShell } from "@/components/PageShell";
import { ReadError } from "@/components/ReadError";
import { formatDay } from "@/lib/dates";
import { ActingBanner } from "@/modules/companies/components";
import { getCompanyContext } from "../server";
import { CompanyNav } from "./CompanyNav";

export async function RealCompanyShell({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await getCompanyContext(slug);
  if (!result || (!result.ok && result.error === "unauthorized"))
    redirect("/login");
  if (!result.ok) {
    if (result.error === "not_found" || result.error === "forbidden")
      notFound();
    return (
      <PageShell>
        <ReadError message={result.message} href={`/${slug}`} />
      </PageShell>
    );
  }
  const { company, role, session } = result.data;
  return (
    <section aria-label="Company shell" className="min-w-0">
      {role === "agency_staff" && session.actingUntil && (
        <ActingBanner
          company={company.name}
          reason={session.actingReason ?? ""}
          until={formatDay(session.actingUntil, company.timezone)}
        />
      )}
      <CompanyNav view={result.data} />
      <PageShell wide>{children}</PageShell>
    </section>
  );
}
