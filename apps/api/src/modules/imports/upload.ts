import { join } from "node:path";
import { AppError } from "@anar/domain/errors";
import type { MappingSuggestion, UploadResultReal } from "@anar/domain/imports";
import { v7 } from "uuid";
import type { RateLimitResult } from "../auth/rateLimits.js";
import audit from "../tenant/audit.js";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import files from "./files.js";
import mapping from "./mapping.js";
import parse from "./parse.js";
import repository, { type StoredBatch } from "./repository.js";
import type { ImportDeps } from "./service.js";
import type { ReadControl } from "./types.js";

export type UploadInput = {
  fileName: string;
  contentType: string;
  bytes: AsyncIterable<Uint8Array>;
  ip: string | null;
};

const extensions = /\.(csv|txt)$/i;
const types = new Set([
  "text/csv",
  "text/plain",
  "application/vnd.ms-excel",
  "text/tab-separated-values",
]);
// Browsers send no type, or octet-stream, for a file they do not know; the bytes decide then.
const unknownTypes = new Set(["", "application/octet-stream"]);

const upload = {
  // Checked before any byte is read, so a refused upload leaves no file.
  admitUpload(deps: ImportDeps, actor: Ctx): Promise<RateLimitResult> {
    return deps.context.withContext(actor, (tx, current) => {
      permissions.require(current, "imports.upload");
      return deps.limitUpload(tx, current.user.id);
    });
  },
  async createImportBatch(
    deps: ImportDeps,
    actor: Ctx,
    input: UploadInput,
    control: ReadControl,
  ): Promise<UploadResultReal> {
    const fileName = input.fileName.trim();
    const type = input.contentType.split(";")[0].trim().toLowerCase();
    if (
      !extensions.test(fileName) ||
      fileName.length > 255 ||
      !(types.has(type) || unknownTypes.has(type))
    )
      throw new AppError("validation", "Choose a CSV or TXT file");
    permissions.require(actor, "imports.upload");
    const temp = await files.writeTemp(deps.uploadsRoot, input.bytes, control);
    let placed: string | null = null;
    try {
      const profile = await parse.profileCsv(temp.path, control);
      control.signal.throwIfAborted();
      return await deps.context.withContext(actor, async (tx, current) => {
        permissions.require(current, "imports.upload");
        const suggestion = mapping.matchMapping({
          profile,
          fields: (await deps.loadSchema(tx)).fields,
          templates: await repository.listTemplates(tx),
          fileName,
        });
        const id = v7();
        placed = await files.place(
          deps.uploadsRoot,
          temp.path,
          current.companyId,
          id,
        );
        await repository.insertBatch(tx, {
          id,
          companyId: current.companyId,
          uploadedBy: current.user.id,
          sourceKind: "csv",
          fileName,
          filePath: placed,
          fileSize: temp.size,
          encoding: profile.encoding,
          delimiter: profile.delimiter,
          rowCount: profile.rowCount,
          status: "uploaded",
          mappingTemplateId: suggestion.matchedTemplate?.id ?? null,
          profile,
        });
        await audit.audit(
          tx,
          {
            user: current.user,
            role: current.role,
            agencyId: current.agencyId,
            companyId: current.companyId,
            ip: input.ip,
          },
          "imports.uploaded",
          { type: "import_batch", id },
          { batchId: id, rowCount: String(profile.rowCount) },
        );
        const batch = await repository.readBatch(tx, id);
        if (!batch)
          throw new AppError("unavailable", "The upload was not saved");
        return upload._result(batch, suggestion);
      });
    } catch (error) {
      await files.remove(temp.path);
      if (placed) await files.remove(join(deps.uploadsRoot, placed));
      throw error;
    }
  },
  async getUploadResult(
    deps: ImportDeps,
    actor: Ctx,
    batchId: string,
  ): Promise<UploadResultReal> {
    return deps.context.withContext(actor, async (tx, current) => {
      permissions.require(current, "imports.upload");
      const batch = await repository.readBatch(tx, batchId);
      if (!batch) throw new AppError("not_found", "Import not found");
      const suggestion = mapping.matchMapping({
        profile: batch.profile,
        fields: (await deps.loadSchema(tx)).fields,
        templates: await repository.listTemplates(tx),
        fileName: batch.fileName,
      });
      return upload._result(batch, suggestion);
    });
  },
  _result(batch: StoredBatch, suggestion: MappingSuggestion): UploadResultReal {
    const { profile } = batch;
    return {
      batchId: batch.id,
      encoding: profile.encoding,
      delimiter: profile.delimiter,
      rowCount: profile.rowCount,
      fileName: batch.fileName,
      headers: profile.columns.map((column) => column.header),
      sample: profile.sample,
      dateRange: profile.dateRange,
      warnings: profile.warning ? [profile.warning] : [],
      ...suggestion,
    };
  },
};
export default upload;
