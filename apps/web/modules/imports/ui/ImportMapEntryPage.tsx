import { notFound, redirect } from "next/navigation";
import { dataMode } from "@/lib/api/mode";
import { AppError } from "@/lib/errors";
import { getSettings, loadSchema } from "@/modules/settings/server";
import {
  can,
  hasCapability,
  homeFor,
  requireContext,
  requireFeatureContext,
} from "@/modules/tenant/server";
import {
  dryRunImport,
  getImportBatch,
  getRealImportBatch,
  getRealImportDraft,
  getRealUploadResult,
  getUploadResult,
} from "../server";
import { templateNameFromFile } from "../templates";
import { ImportMapPage } from "./ImportMapPage";

export async function ImportMapEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; batchId: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { slug, batchId } = await params;
  try {
    if (dataMode() === "real") return await realPage(slug, batchId);
    return await demoPage(slug, batchId, (await searchParams).step);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
}

async function realPage(slug: string, batchId: string) {
  const view = await requireFeatureContext(slug);
  if (!("capabilities" in view) || !hasCapability(view, "imports.upload"))
    redirect(`/${slug}`);
  const [report, upload, draft, settings] = await Promise.all([
    getRealImportBatch(slug, batchId),
    getRealUploadResult(slug, batchId),
    getRealImportDraft(slug, batchId),
    getSettings(slug),
  ]);
  if (report.status !== "uploaded") redirect(`/${slug}/imports/${batchId}`);
  if (!settings?.ok)
    throw new AppError(
      settings?.error ?? "unavailable",
      settings?.message ?? "Settings are not available yet.",
    );
  return (
    <ImportMapPage
      mode="real"
      slug={slug}
      upload={upload}
      initialDraft={draft}
      fields={settings.data.fields.filter((field) => !field.archivedAt)}
      templateName={templateNameFromFile(upload.fileName)}
    />
  );
}

async function demoPage(slug: string, batchId: string, step?: string) {
  const ctx = await requireContext(slug);
  if (!can(ctx, "imports.upload")) redirect(homeFor(ctx));
  const batch = await getImportBatch(ctx, batchId);
  if (batch.status === "done") redirect(`/${slug}/imports/${batchId}`);
  const upload = await getUploadResult(ctx, batchId);
  const schema = await loadSchema(ctx);
  const review =
    step === "check"
      ? await dryRunImport(ctx, { batchId, mapping: upload.suggestedMapping })
      : null;
  return (
    <ImportMapPage
      mode="demo"
      slug={slug}
      upload={upload}
      fields={schema.fields}
      initialReview={review}
      templateName={templateNameFromFile(batch.fileName)}
    />
  );
}
