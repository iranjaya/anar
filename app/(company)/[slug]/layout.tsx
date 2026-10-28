import type { ReactNode } from "react";
import { leaveCompanyAction } from "@/modules/companies/actions";
import { CompanyShell } from "@/modules/tenant/pages";

export default function CompanyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  return (
    <CompanyShell params={params} onLeaveAction={leaveCompanyAction}>
      {children}
    </CompanyShell>
  );
}
