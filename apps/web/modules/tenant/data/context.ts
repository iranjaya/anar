import { cookies } from "next/headers";
import { z } from "zod";
import { requireDemoMode } from "@/lib/api/mode";
import { AppError } from "@/lib/errors";
import {
  resetDemoStore,
  setDemoFailure as setFailure,
  store,
} from "@/mock/access";
import { db } from "@/mock/store";
import { can, homeFor } from "../permissions";
import type { Company, Ctx, DemoUser } from "../types";

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

export async function readDemoIdentity(): Promise<DemoIdentity> {
  requireDemoMode();
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
  return parsed.data;
}

export async function requireContext(slug: string): Promise<Ctx> {
  return resolveContext(await readDemoIdentity(), slug);
}

export async function requireDemoContext(): Promise<Ctx> {
  const demo = await readDemoIdentity();
  const data = await store();
  const user = data.users.find((user) => user.id === demo.userId);
  if (!user) throw new AppError("unauthorized", "Choose a demo user.");
  if (user.platformRole === "dna") {
    return {
      user,
      companyId: demo.actingCompanyId ?? "",
      member: null,
      role: "dna",
      session: { id: "demo", actingCompanyId: demo.actingCompanyId },
    };
  }
  const member = data.members.find(
    (member) => member.userId === user.id && member.status === "active",
  );
  const company = data.companies.find(
    (company) => company.id === member?.companyId,
  );
  if (!company)
    throw new AppError("unauthorized", "This membership is inactive.");
  return resolveContext(demo, company.slug);
}

export async function verifyContext(ctx: Ctx): Promise<Ctx> {
  requireDemoMode();
  const data = await store();
  const company = data.companies.find(
    (company) => company.id === ctx.companyId,
  );
  if (!company) throw new AppError("not_found", "Company not found.");
  return resolveContext(
    { userId: ctx.user.id, actingCompanyId: ctx.session.actingCompanyId },
    company.slug,
  );
}

export async function getCompanyShell(
  slug: string,
): Promise<{ ctx: Ctx; company: Company }> {
  const ctx = await requireContext(slug);
  const data = await store();
  const company = data.companies.find(
    (company) => company.id === ctx.companyId,
  );
  if (!company) throw new AppError("not_found", "Company not found.");
  return { ctx, company };
}

export async function setActingCompany(
  companyId: string | null,
): Promise<void> {
  const ctx = await requireDemoContext();
  if (!can(ctx, "company.enter"))
    throw new AppError("forbidden", "Only DNA can enter companies.");
  if (companyId !== null) {
    const data = await store();
    if (
      !data.companies.some(
        (company) => company.id === companyId && company.status === "active",
      )
    ) {
      throw new AppError("not_found", "Company not found.");
    }
  }
  (await cookies()).set(
    "anar_demo",
    JSON.stringify({ userId: ctx.user.id, actingCompanyId: companyId }),
    { httpOnly: true, sameSite: "lax", path: "/" },
  );
}

export async function getDemoControls(): Promise<{
  users: DemoUser[];
  userId: string;
  failure: boolean;
  message: string;
}> {
  let userId = "";
  let message = "";
  try {
    userId = (await readDemoIdentity()).userId;
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "unauthorized")
      throw error;
    message = error.message;
  }
  let failure = false;
  try {
    await store();
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "unavailable")
      throw error;
    failure = true;
  }
  const data = db();
  return {
    users: [
      ...data.users
        .filter((user) => user.platformRole === "dna")
        .map((user) => ({
          id: user.id,
          name: user.name,
          role: "dna" as const,
          companyName: null,
        })),
      ...data.companies.flatMap((company) =>
        data.members
          .filter((member) => member.companyId === company.id)
          .map((member) => ({
            id: member.userId,
            name: member.name,
            role: member.role,
            companyName: company.name,
          })),
      ),
    ],
    userId,
    failure,
    message,
  };
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
