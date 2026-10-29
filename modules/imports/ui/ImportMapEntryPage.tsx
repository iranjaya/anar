import { notFound, redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { loadSchema } from "@/modules/settings/server";
import { can, homeFor, requireContext } from "@/modules/tenant/server";
import { dryRunImport, getImportBatch, getUploadResult } from "../server";
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
  const ctx = await requireContext(slug);
  if (!can(ctx, "imports.upload")) redirect(homeFor(ctx));
  try {
    const batch = await getImportBatch(ctx, batchId);
    if (batch.status === "done") redirect(`/${slug}/imports/${batchId}`);
    const upload = await getUploadResult(ctx, batchId);
    const schema = await loadSchema(ctx);
    const query = await searchParams;
    const review =
      query.step === "check"
        ? await dryRunImport(ctx, { batchId, mapping: upload.suggestedMapping })
        : null;
    return (
      <ImportMapPage
        slug={slug}
        upload={upload}
        fields={schema.fields}
        initialReview={review}
        templateName={templateNameFromFile(batch.fileName)}
      />
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
}
