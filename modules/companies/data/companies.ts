import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import {
  can,
  requireDemoContext,
  setActingCompany,
} from "@/modules/tenant/server";
import type { Company } from "@/modules/tenant/types";

export async function listCompanies(): Promise<
  (Company & { memberCount: number; leadCount: number })[]
> {
  const ctx = await requireDemoContext();
  if (!can(ctx, "company.list"))
    throw new AppError("forbidden", "Only DNA can view companies.");
  const data = await store();
  return data.companies.map((company) => ({
    ...company,
    memberCount: data.members.filter(
      (member) => member.companyId === company.id && member.status === "active",
    ).length,
    leadCount: data.leads.filter(
      (lead) =>
        lead.companyId === company.id &&
        lead.deletedAt === null &&
        lead.mergedIntoId === null,
    ).length,
  }));
}

export async function enterCompany(
  companyId: string,
): Promise<{ redirectTo: string }> {
  const ctx = await requireDemoContext();
  if (!can(ctx, "company.enter"))
    throw new AppError("forbidden", "Only DNA can enter companies.");
  const data = await store();
  const company = data.companies.find(
    (company) => company.id === companyId && company.status === "active",
  );
  if (!company) throw new AppError("not_found", "Company not found.");
  await setActingCompany(company.id);
  return { redirectTo: `/${company.slug}/imports/new` };
}

export async function leaveCompany(): Promise<{ redirectTo: string }> {
  await setActingCompany(null);
  return { redirectTo: "/companies" };
}
