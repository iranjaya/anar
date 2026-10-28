import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { type ActionResult, AppError } from "@/lib/errors";
import { getCompanyShell } from "../server";
import { DnaBanner } from "./DnaBanner";
import { ShellError } from "./ShellError";
import { TopNav } from "./TopNav";

export async function CompanyShell({
  children,
  params,
  onLeaveAction,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
  onLeaveAction: () => Promise<ActionResult<{ redirectTo: string }>>;
}) {
  const { slug } = await params;
  let shell: Awaited<ReturnType<typeof getCompanyShell>>;
  try {
    shell = await getCompanyShell(slug);
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "not_found") notFound();
      if (error.code === "forbidden") redirect("/companies");
      if (error.code === "unavailable")
        return (
          <section aria-label="Company shell">
            <header className="border-b border-line bg-surface p-4 font-display text-2xl font-bold text-brand">
              Anar
            </header>
            <ShellError />
          </section>
        );
    }
    throw error;
  }
  return (
    <section aria-label="Company shell" className="min-w-0">
      <TopNav ctx={shell.ctx} companyName={shell.company.name} />
      {shell.ctx.role === "dna" && (
        <DnaBanner
          companyName={shell.company.name}
          onLeaveAction={onLeaveAction}
        />
      )}
      {children}
    </section>
  );
}
