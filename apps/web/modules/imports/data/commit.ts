import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { buildMetaExport } from "@/mock/metaExport";
import type { MockStore } from "@/mock/store";
import { addImportedLeads } from "@/modules/leads/server";
import { createFields, loadSchema } from "@/modules/settings/server";
import { can, verifyContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import type { DryRun, ImportBatch, ImportRow, Mapping } from "../types";
import { getImportBatch } from "./batches";
import { findTemplate, headerFingerprint } from "./templates";

export const dryRunInputSchema = z.object({
  batchId: z.string().min(1),
  mapping: z
    .array(
      z.object({
        header: z.string().min(1),
        target: z.union([
          z.enum([
            "system:full_name",
            "system:phone",
            "system:email",
            "system:lead_date",
            "system:campaign_name",
            "system:source",
            "skip",
          ]),
          z.templateLiteral(["field:", z.string().regex(/^[a-z][a-z0-9_]*$/)]),
        ]),
      }),
    )
    .min(1),
});

export const commitInputSchema = dryRunInputSchema.extend({
  saveTemplate: z.object({ name: z.string().trim().min(1) }).optional(),
  newFields: z
    .array(
      z.object({
        header: z.string().min(1),
        key: z.string().regex(/^[a-z][a-z0-9_]*$/),
        label: z.string().trim().min(1),
        type: z.enum(["text", "number", "date", "dropdown"]),
        options: z
          .array(
            z.object({
              value: z.string().min(1),
              label: z.string().trim().min(1),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

function fixtureRows(data: MockStore, batch: ImportBatch) {
  const fixture = buildMetaExport(data, batch.companyId, batch.createdAt);
  const existing = new Map(data.leads.map((lead) => [lead.id, lead]));
  const rows = fixture.rows.map((item, index) => {
    const stored = existing.get(item.lead.id);
    const repeated =
      item.result === "imported" && stored && stored.importBatchId !== batch.id;
    const row: ImportRow = {
      id: `${batch.id}-${index + 1}`,
      batchId: batch.id,
      rowNo: index + 1,
      raw: item.raw,
      phoneE164: item.lead.phoneE164,
      leadId: stored ? item.lead.id : null,
      result: repeated ? "duplicate_db" : item.result,
      reason: repeated ? "same_submission" : item.reason,
    };
    return { lead: item.lead, row };
  });
  return { headers: fixture.headers, rows };
}

function validateMapping(headers: string[], mapping: Mapping) {
  if (
    mapping.length !== headers.length ||
    new Set(mapping.map((row) => row.header)).size !== headers.length ||
    mapping.some((row) => !headers.includes(row.header))
  )
    throw new AppError("validation", "Match each file column once.");
  if (mapping.filter((row) => row.target === "system:phone").length !== 1)
    throw new AppError("validation", "Match exactly one column to Phone.");
}

export async function dryRunImport(
  ctx: Ctx,
  input: z.infer<typeof dryRunInputSchema>,
): Promise<DryRun> {
  const parsed = dryRunInputSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Check the column mapping.");
  const batch = await getImportBatch(ctx, parsed.data.batchId);
  const data = await store();
  const fixture = fixtureRows(data, batch);
  validateMapping(fixture.headers, parsed.data.mapping);
  const rows = fixture.rows.map((item) => item.row);
  const phoneReview = rows.filter(
    (row) => row.result === "imported" && row.reason === "invalid_phone",
  );
  return {
    toAdd: rows.filter((row) => row.result === "imported").length,
    needPhoneReview: phoneReview.length,
    sameSubmission: rows.filter((row) => row.reason === "same_submission")
      .length,
    resubmitted: rows.filter((row) => row.reason === "resubmitted"),
    duplicateFile: rows.filter((row) => row.result === "duplicate_file"),
    phoneReview,
  };
}

export async function commitImport(
  ctx: Ctx,
  input: z.infer<typeof commitInputSchema>,
): Promise<{ jobId: string }> {
  const parsed = commitInputSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("validation", "Check the mapping and new fields.");
  const current = await verifyContext(ctx);
  if (!can(current, "imports.commit"))
    throw new AppError("forbidden", "You cannot import leads.");
  const batch = await getImportBatch(current, parsed.data.batchId);
  const data = await store();
  const schema = await loadSchema(current);
  const { mapping, saveTemplate, newFields = [] } = parsed.data;
  const fixture = fixtureRows(data, batch);
  validateMapping(fixture.headers, mapping);
  const keys = new Set([
    ...schema.fields.map((field) => field.key),
    ...newFields.map((field) => field.key),
  ]);
  if (
    mapping.some(
      (row) =>
        row.target.startsWith("field:") && !keys.has(row.target.slice(6)),
    ) ||
    newFields.some(
      (field) =>
        !mapping.some(
          (row) =>
            row.header === field.header && row.target === `field:${field.key}`,
        ),
    )
  )
    throw new AppError(
      "validation",
      "Match new fields to their file columns or choose existing fields.",
    );
  let template = await findTemplate(current, fixture.headers);
  if (batch.status === "done") return { jobId: batch.id };
  if (batch.status === "running")
    throw new AppError("conflict", "This import is already running.");
  batch.status = "running";
  try {
    if (newFields.length) await createFields(current, newFields);
    const leads = fixture.rows
      .filter((item) => item.row.result === "imported")
      .map(({ lead, row }) => ({
        ...lead,
        importBatchId: batch.id,
        custom: Object.fromEntries(
          mapping
            .filter((column) => column.target.startsWith("field:"))
            .map((column) => [column.target.slice(6), row.raw[column.header]]),
        ),
      }));
    await addImportedLeads(current, leads);
    const rows = fixtureRows(data, batch).rows.map((item) => item.row);
    if (saveTemplate) {
      if (template)
        Object.assign(template, {
          name: saveTemplate.name,
          mapping: structuredClone(mapping),
        });
      else {
        template = {
          id: randomUUID(),
          companyId: current.companyId,
          name: saveTemplate.name,
          headerFingerprint: headerFingerprint(fixture.headers),
          headers: fixture.headers,
          mapping: structuredClone(mapping),
          formName: null,
          campaignName: null,
          createdBy: current.user.id,
          lastUsedAt: null,
        };
        data.mappingTemplates.push(template);
      }
    }
    if (template) template.lastUsedAt = new Date();
    data.importRows.push(...rows);
    batch.mapping = structuredClone(mapping);
    batch.mappingTemplateId = template?.id ?? null;
    batch.lastRowNo = batch.rowCount;
    batch.summary = {
      imported: rows.filter((row) => row.result === "imported").length,
      needPhoneReview: rows.filter(
        (row) => row.result === "imported" && row.reason === "invalid_phone",
      ).length,
      duplicateDb: rows.filter((row) => row.result === "duplicate_db").length,
      duplicateFile: rows.filter((row) => row.result === "duplicate_file")
        .length,
      invalid: rows.filter((row) => row.result === "invalid").length,
      error: rows.filter((row) => row.result === "error").length,
      newOptions: 0,
    };
    batch.status = "done";
    return { jobId: batch.id };
  } catch (error) {
    batch.status = "failed";
    throw error;
  }
}
