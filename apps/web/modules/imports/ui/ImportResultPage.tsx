import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { dataMode } from "@/lib/api/mode";
import { AppError } from "@/lib/errors";
import { can, homeFor, requireContext } from "@/modules/tenant/server";
import {
  getImportBatch,
  getRealImportBatch,
  listImportRows,
  listRealImportRows,
} from "../server";
import type { ImportReport, ImportRowsPage } from "../types";
import { ImportRowList } from "./CheckStep";
import { ImportProgress } from "./ImportProgress";
import { ImportRail } from "./ImportRail";

export async function ImportResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; batchId: string }>;
  searchParams: Promise<{ filter?: string; after?: string }>;
}) {
  const { slug, batchId } = await params;
  if (dataMode() === "real")
    return realResult(slug, batchId, await searchParams);
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

const filters = [
  { value: "exceptions", label: "Needs a look" },
  { value: "phone_review", label: "Phone review" },
  { value: "all", label: "All rows" },
] as const;
type Filter = (typeof filters)[number]["value"];

async function realResult(
  slug: string,
  batchId: string,
  query: { filter?: string; after?: string },
) {
  const filter: Filter =
    filters.find((item) => item.value === query.filter)?.value ?? "exceptions";
  const after = Number(query.after);
  const afterRowNo = Number.isInteger(after) && after > 0 ? after : undefined;
  let report: ImportReport;
  let page: ImportRowsPage;
  try {
    [report, page] = await Promise.all([
      getRealImportBatch(slug, batchId),
      listRealImportRows(slug, { batchId, filter, afterRowNo }),
    ]);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    if (error instanceof AppError && error.code === "forbidden")
      redirect(`/${slug}`);
    throw error;
  }
  if (report.status === "uploaded") redirect(`/${slug}/imports/${batchId}/map`);
  const base = `/${slug}/imports/${batchId}`;
  const summary = report.runState === "done" ? report.summary : null;
  return (
    <PageShell wide>
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold">
          {summary ? "Import complete" : "Import in progress"}
        </h1>
        <p className="mt-2 break-all font-mono text-sm text-muted">
          {report.fileName}
        </p>
      </header>
      <div className="min-w-0 lg:flex lg:gap-8">
        <ImportRail step={4} />
        <div className="grid min-w-0 flex-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="min-w-0 space-y-6 pb-16 lg:pb-0">
            {summary ? (
              <section
                aria-label="Import result summary"
                className="min-w-0 rounded-2xl border border-line bg-surface p-5"
              >
                <h2 className="font-display text-4xl font-bold">
                  {summary.imported} added
                </h2>
                <p className="mt-3 text-sm text-muted">
                  New leads are unassigned. The lead queue opens with the lead
                  screens.
                </p>
                <dl className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 text-sm">
                  <dt>Rows in the file</dt>
                  <dd className="font-semibold">{report.rowCount}</dd>
                  <dt>Need phone review</dt>
                  <dd className="font-semibold">{summary.needPhoneReview}</dd>
                  <dt>Already in, skipped</dt>
                  <dd className="font-semibold">{summary.duplicateDb}</dd>
                  <dt>Duplicates in this file, skipped</dt>
                  <dd className="font-semibold">{summary.duplicateFile}</dd>
                  <dt>Rows that can't be read</dt>
                  <dd className="font-semibold">{summary.invalid}</dd>
                  <dt>New answers added</dt>
                  <dd className="font-semibold">{summary.newOptions}</dd>
                </dl>
              </section>
            ) : (
              <ImportProgress slug={slug} report={report} />
            )}
            <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:static lg:border-0 lg:p-0">
              <Link
                href={`/${slug}/imports/new`}
                className="flex min-h-14 items-center justify-center rounded-xl border border-brand px-4 text-center font-semibold text-brand"
              >
                Import another
              </Link>
            </div>
          </div>
          <div className="min-w-0 space-y-4">
            <nav aria-label="Row filter" className="flex flex-wrap gap-2">
              {filters.map((item) => (
                <Link
                  key={item.value}
                  href={`${base}?filter=${item.value}`}
                  aria-current={item.value === filter ? "page" : undefined}
                  className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold aria-[current=page]:border-brand aria-[current=page]:bg-brand-soft aria-[current=page]:text-brand"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <ImportRowList
              slug={slug}
              title={`${filters.find((item) => item.value === filter)?.label}: ${page.total} rows`}
              rows={page.items}
              leadLinks={false}
            />
            <div className="flex flex-wrap gap-4">
              {afterRowNo && (
                <Link
                  href={`${base}?filter=${filter}`}
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline"
                >
                  First rows
                </Link>
              )}
              {page.nextRowNo && (
                <Link
                  href={`${base}?filter=${filter}&after=${page.nextRowNo}`}
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline"
                >
                  Next 50 rows
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
