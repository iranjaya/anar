import { notFound, redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { loadSchema } from "@/modules/settings/server";
import { can, homeFor, requireContext } from "@/modules/tenant/server";
import { getUploadResult } from "../server";
import { ImportMapPage } from "./ImportMapPage";

export async function ImportMapEntryPage({
  params,
}: {
  params: Promise<{ slug: string; batchId: string }>;
}) {
  const { slug, batchId } = await params;
  const ctx = await requireContext(slug);
  if (!can(ctx, "imports.upload")) redirect(homeFor(ctx));
  try {
    const upload = await getUploadResult(ctx, batchId);
    const schema = await loadSchema(ctx);
    return <ImportMapPage slug={slug} upload={upload} fields={schema.fields} />;
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
}
