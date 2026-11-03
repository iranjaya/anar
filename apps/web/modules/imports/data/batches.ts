import { slugSchema } from "@anar/domain/agencies";
import {
  type ImportReport,
  type ImportRowsPage,
  type ImportRowsQuery,
  importRowsQuerySchema,
} from "@anar/domain/imports";
import { z } from "zod";
import { apiRequest } from "@/lib/api/client";
import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { can, verifyContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import type { ImportBatch, ImportRow } from "../types";
import { importReportSchema, importRowsPageSchema } from "./wire";

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

export async function getRealImportBatch(
  slug: string,
  batchId: string,
): Promise<ImportReport> {
  const company = slugSchema.safeParse(slug);
  const batch = z.uuid().safeParse(batchId);
  if (!company.success || !batch.success)
    throw new AppError("not_found", "Import not found.");
  return apiRequest(
    {
      path: `/api/companies/${company.data}/imports/getImportBatch`,
      query: { batchId: batch.data },
    },
    importReportSchema,
  );
}

export async function listRealImportRows(
  slug: string,
  query: ImportRowsQuery,
): Promise<ImportRowsPage> {
  const company = slugSchema.safeParse(slug);
  const parsed = importRowsQuerySchema.safeParse(query);
  if (!company.success || !parsed.success)
    throw new AppError("not_found", "Import not found.");
  const { batchId, afterRowNo, filter } = parsed.data;
  return apiRequest(
    {
      path: `/api/companies/${company.data}/imports/listImportRows`,
      query: {
        batchId,
        ...(afterRowNo ? { afterRowNo: String(afterRowNo) } : {}),
        ...(filter ? { filter } : {}),
      },
    },
    importRowsPageSchema,
  );
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
