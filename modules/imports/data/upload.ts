import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { buildMetaExport, metaFields } from "@/mock/metaExport";
import { can, verifyContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import type { Mapping, UploadResult } from "../types";
import { findTemplate } from "./templates";

export async function createImportBatch(
  ctx: Ctx,
  file: { fileName: string; fileSize: number },
): Promise<UploadResult> {
  const parsed = z
    .object({
      fileName: z.string().min(1),
      fileSize: z
        .number()
        .int()
        .min(0)
        .max(25 * 1024 * 1024),
    })
    .safeParse(file);
  if (!parsed.success)
    throw new AppError("validation", "Choose a CSV file under 25 MB.");
  const current = await verifyContext(ctx);
  if (!can(current, "imports.upload"))
    throw new AppError("forbidden", "You cannot import leads.");
  const data = await store();
  const now = new Date();
  const fixture = buildMetaExport(data, current.companyId, now);
  const template = await findTemplate(current, fixture.headers);
  const batchId = randomUUID();
  data.importBatches.push({
    id: batchId,
    companyId: current.companyId,
    uploadedBy: current.user.id,
    sourceKind: "csv",
    fileName: parsed.data.fileName,
    fileSize: parsed.data.fileSize,
    encoding: "utf-16le",
    delimiter: "\t",
    rowCount: fixture.rows.length,
    status: "uploaded",
    mappingTemplateId: template?.id ?? null,
    mapping: template ? structuredClone(template.mapping) : null,
    lastRowNo: 0,
    summary: null,
    createdAt: now,
  });
  return getUploadResult(current, batchId);
}

export async function getUploadResult(
  ctx: Ctx,
  batchId: string,
): Promise<UploadResult> {
  const current = await verifyContext(ctx);
  if (!can(current, "imports.upload"))
    throw new AppError("forbidden", "You cannot import leads.");
  const data = await store();
  const batch = data.importBatches.find(
    (batch) => batch.id === batchId && batch.companyId === current.companyId,
  );
  if (!batch) throw new AppError("not_found", "Import not found.");
  const fixture = buildMetaExport(data, current.companyId, batch.createdAt);
  const template = await findTemplate(current, fixture.headers);
  const systemTargets: Record<string, Mapping[number]["target"]> = {
    created_time: "system:lead_date",
    campaign_name: "system:campaign_name",
    platform: "system:source",
    full_name: "system:full_name",
    phone: "system:phone",
    email: "system:email",
  };
  const proposedFields = template ? [] : structuredClone(metaFields);
  const suggestedMapping: Mapping = fixture.headers.map((header) => {
    const target = systemTargets[header];
    if (target) return { header, target };
    const field = proposedFields.find((field) => field.header === header);
    return { header, target: field ? `field:${field.key}` : "skip" };
  });
  const times = fixture.rows.map((row) => row.lead.leadDate.getTime());
  return {
    batchId,
    encoding: batch.encoding,
    delimiter: batch.delimiter,
    headers: fixture.headers,
    sample: fixture.rows
      .slice(0, 20)
      .map((row) => fixture.headers.map((header) => row.raw[header])),
    rowCount: batch.rowCount,
    dateRange: {
      from: new Date(Math.min(...times)),
      to: new Date(Math.max(...times)),
    },
    ...(template
      ? { matchedTemplate: { id: template.id, name: template.name } }
      : {}),
    suggestedMapping: template
      ? structuredClone(template.mapping)
      : suggestedMapping,
    proposedFields,
    newColumns: proposedFields.map((field) => field.header),
    missingColumns: [],
  };
}
