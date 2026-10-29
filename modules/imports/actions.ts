"use server";

import { z } from "zod";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";
import { can, requireContext } from "@/modules/tenant/server";
import { commitInputSchema, dryRunInputSchema } from "./data/commit";
import { commitImport, createImportBatch, dryRunImport } from "./server";
import type { DryRun, UploadResult } from "./types";

export async function createImportBatchAction(input: {
  slug: string;
  fileName: string;
  fileSize: number;
}): Promise<ActionResult<UploadResult>> {
  const parsed = z
    .object({
      slug: z.string().min(1),
      fileName: z.string().min(1),
      fileSize: z
        .number()
        .int()
        .min(0)
        .max(25 * 1024 * 1024),
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: "validation",
      message: "Choose a CSV file under 25 MB.",
    };
  try {
    const ctx = await requireContext(parsed.data.slug);
    if (!can(ctx, "imports.upload"))
      throw new AppError("forbidden", "You cannot import leads.");
    return { ok: true, data: await createImportBatch(ctx, parsed.data) };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function dryRunImportAction(
  input: Parameters<typeof dryRunImport>[1] & { slug: string },
): Promise<ActionResult<DryRun>> {
  const parsed = dryRunInputSchema
    .extend({ slug: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: "validation",
      message: "Check the column mapping.",
    };
  try {
    const ctx = await requireContext(parsed.data.slug);
    if (!can(ctx, "imports.upload"))
      throw new AppError("forbidden", "You cannot import leads.");
    return { ok: true, data: await dryRunImport(ctx, parsed.data) };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function commitImportAction(
  input: Parameters<typeof commitImport>[1] & { slug: string },
): Promise<ActionResult<{ jobId: string }>> {
  const parsed = commitInputSchema
    .extend({ slug: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: "validation",
      message: "Check the mapping and new fields.",
    };
  try {
    const ctx = await requireContext(parsed.data.slug);
    if (!can(ctx, "imports.commit"))
      throw new AppError("forbidden", "You cannot import leads.");
    return { ok: true, data: await commitImport(ctx, parsed.data) };
  } catch (error) {
    return actionFailure(error);
  }
}
