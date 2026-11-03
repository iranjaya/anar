import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageShell } from "@/components/PageShell";
import { AppError } from "@/lib/errors";
import { loadSchema } from "@/modules/settings/server";
import { getCompanyShell } from "@/modules/tenant/server";
import { getLead } from "../server";
import { LeadDetailView } from "./LeadDetailView";

export async function LeadDetailPage({
  params,
  callSheet,
}: {
  params: Promise<{ slug: string; id: string }>;
  callSheet?: ReactNode;
}) {
  const { slug, id } = await params;
  const { ctx, company } = await getCompanyShell(slug);
  try {
    const [detail, schema] = await Promise.all([
      getLead(ctx, id),
      loadSchema(ctx),
    ]);
    return (
      <PageShell wide className="lg:pb-10">
        <LeadDetailView
          key={id}
          detail={detail}
          schema={schema}
          ctx={ctx}
          timezone={company.timezone}
        />
        {callSheet}
      </PageShell>
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
}
