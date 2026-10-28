import { cookies } from "next/headers";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import {
  resetDemoStore,
  setDemoFailure as setFailure,
  store,
} from "@/mock/access";
import { homeFor } from "../permissions";
import type { Ctx } from "../types";

const demoSchema = z.object({
  userId: z.string().min(1),
  actingCompanyId: z.string().min(1).nullable(),
});
export type DemoIdentity = z.infer<typeof demoSchema>;

export async function resolveContext(
  demo: DemoIdentity,
  slug: string,
): Promise<Ctx> {
  const data = await store();
  const user = data.users.find((user) => user.id === demo.userId);
  if (!user) throw new AppError("unauthorized", "Choose a demo user.");
  const company = data.companies.find(
    (company) => company.slug === slug && company.status === "active",
  );
  if (!company) throw new AppError("not_found", "Company not found.");
  const session = { id: "demo", actingCompanyId: demo.actingCompanyId };
  if (user.platformRole === "dna") {
    if (demo.actingCompanyId !== company.id)
      throw new AppError("forbidden", "Enter this company first.");
    return { user, companyId: company.id, member: null, role: "dna", session };
  }
  const member = data.members.find(
    (member) => member.userId === user.id && member.companyId === company.id,
  );
  if (!member) throw new AppError("not_found", "Company not found.");
  if (member.status !== "active")
    throw new AppError("unauthorized", "This membership is inactive.");
  return { user, companyId: company.id, member, role: member.role, session };
}

export async function requireContext(slug: string): Promise<Ctx> {
  const cookie = (await cookies()).get("anar_demo");
  let identity: unknown = { userId: "sunaina", actingCompanyId: null };
  if (cookie) {
    try {
      identity = JSON.parse(cookie.value);
    } catch {
      throw new AppError("unauthorized", "Choose a demo user.");
    }
  }
  const parsed = demoSchema.safeParse(identity);
  if (!parsed.success)
    throw new AppError("unauthorized", "Choose a demo user.");
  return resolveContext(parsed.data, slug);
}

export async function switchDemoUser(
  userId: string,
): Promise<{ demo: DemoIdentity; redirectTo: string }> {
  const data = await store();
  const user = data.users.find((user) => user.id === userId);
  if (!user) throw new AppError("unauthorized", "Choose a demo user.");
  const demo = { userId, actingCompanyId: null };
  if (user.platformRole === "dna") return { demo, redirectTo: "/companies" };
  const member = data.members.find(
    (member) => member.userId === userId && member.status === "active",
  );
  if (!member)
    throw new AppError("unauthorized", "This membership is inactive.");
  const company = data.companies.find(
    (company) => company.id === member.companyId,
  );
  if (!company) throw new AppError("not_found", "Company not found.");
  const ctx = await resolveContext(demo, company.slug);
  return { demo, redirectTo: homeFor(ctx) };
}

export async function resetDemo(): Promise<void> {
  await resetDemoStore(new Date());
}

export async function setDemoFailure(on: boolean): Promise<void> {
  await setFailure(on);
}
