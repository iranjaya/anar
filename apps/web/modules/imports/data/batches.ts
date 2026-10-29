import { z } from "zod";
import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { can, verifyContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import type { ImportBatch, ImportRow } from "../types";

export async function getImportBatch(
  ctx: Ctx,
  batchId: string,
): Promise<ImportBatch> {
  const current = await verifyContext(ctx);
  if (!can(current, "imports.upload"))
    throw new AppError("forbidden", "You cannot view imports.");
  const data = await store();
  const batch = data.importBatches.find(
    (batch) => batch.id === batchId && batch.companyId === current.companyId,
  );
  if (!batch) throw new AppError("not_found", "Import not found.");
  return batch;
}

export async function listImportRows(
  ctx: Ctx,
  input: { batchId: string; result?: ImportRow["result"] },
): Promise<ImportRow[]> {
  const parsed = z
    .object({
      batchId: z.string().min(1),
      result: z
        .enum([
          "imported",
          "duplicate_db",
          "duplicate_file",
          "invalid",
          "error",
        ])
        .optional(),
    })
    .safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Choose an import and row result.");
  const batch = await getImportBatch(ctx, parsed.data.batchId);
  const data = await store();
  return data.importRows.filter(
    (row) =>
      row.batchId === batch.id &&
      (!parsed.data.result || row.result === parsed.data.result),
  );
}
