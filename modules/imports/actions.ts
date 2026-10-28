"use server";

import { z } from "zod";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";
import { can, requireContext } from "@/modules/tenant/server";
import { createImportBatch } from "./server";
import type { UploadResult } from "./types";

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
