import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { AppError } from "@/lib/errors";
import { can, homeFor, requireContext } from "@/modules/tenant/server";
import { getImportBatch, listImportRows } from "../server";
import { ImportRowList } from "./CheckStep";
import { ImportRail } from "./ImportRail";

export async function ImportResultPage({
  params,
}: {
  params: Promise<{ slug: string; batchId: string }>;
}) {
  const { slug, batchId } = await params;
  const ctx = await requireContext(slug);
  if (!can(ctx, "imports.upload")) redirect(homeFor(ctx));
  try {
    const batch = await getImportBatch(ctx, batchId);
    if (batch.status !== "done" || !batch.summary)
      redirect(`/${slug}/imports/${batch.id}/map`);
    const summary = batch.summary;
    const rows = await listImportRows(ctx, { batchId });
    return (
      <PageShell wide>
        <header className="mb-6">
          <h1 className="font-display text-3xl font-bold">Import complete</h1>
          <p className="mt-2 break-all font-mono text-sm text-muted">
            {batch.fileName}
          </p>
        </header>
        <div className="min-w-0 lg:flex lg:gap-8">
          <ImportRail step={4} />
          <div className="grid min-w-0 flex-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <section
              aria-label="Import result summary"
              className="min-w-0 rounded-2xl border border-line bg-surface p-5"
            >
              <h2 className="font-display text-4xl font-bold">
                {summary.imported} added
              </h2>
              <p className="mt-3 text-sm text-muted">
                New leads are unassigned and ready for the queue.
              </p>
              <dl className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 text-sm">
                <dt>Need phone review</dt>
                <dd className="font-semibold">{summary.needPhoneReview}</dd>
                <dt>Already in, skipped</dt>
                <dd className="font-semibold">{summary.duplicateDb}</dd>
                <dt>Duplicates in this file, skipped</dt>
                <dd className="font-semibold">{summary.duplicateFile}</dd>
                <dt>Invalid rows</dt>
                <dd className="font-semibold">{summary.invalid}</dd>
                <dt>Errors</dt>
                <dd className="font-semibold">{summary.error}</dd>
              </dl>
              <div className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-2 gap-3 border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:static lg:mt-6 lg:border-0 lg:p-0">
                <Link
                  href={`/${slug}/leads`}
                  className="flex min-h-14 items-center justify-center rounded-xl bg-brand px-4 text-center font-semibold text-surface"
                >
                  Open queue
                </Link>
                <Link
                  href={`/${slug}/imports/new`}
                  className="flex min-h-14 items-center justify-center rounded-xl border border-brand px-4 text-center font-semibold text-brand"
                >
                  Import another
                </Link>
              </div>
            </section>
            <div className="min-w-0 space-y-6">
              <ImportRowList
                slug={slug}
                title="Added leads that need phone review"
                rows={rows.filter(
                  (row) =>
                    row.result === "imported" && row.reason === "invalid_phone",
                )}
              />
              <ImportRowList
                slug={slug}
                title="New submissions from existing leads"
                rows={rows.filter((row) => row.reason === "resubmitted")}
              />
            </div>
          </div>
        </div>
      </PageShell>
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
}
