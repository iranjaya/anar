import { slugSchema } from "@anar/domain/agencies";
import { AppError } from "@anar/domain/errors";
import { apiSuccessSchema } from "@anar/domain/http";
import {
  batchIdQuerySchema,
  type CommitImportInput,
  commitImportResultWireSchema,
  dryRunWireSchema,
  type ImportDraftInput,
  type ImportRowsQuery,
  importDraftWireSchema,
  importReportWireSchema,
  importRowsPageWireSchema,
  type UploadResultReal,
  uploadResultWireSchema,
} from "@anar/domain/imports";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ImportService } from "./service.js";
import type { ReadControl } from "./types.js";

export type ImportRouteOptions = {
  imports: ImportService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};
type BatchRequest = FastifyRequest<{
  Params: { slug: string };
  Querystring: { batchId?: string };
}>;

const deadlineMs = 120_000;

const routes = {
  async register(
    app: FastifyInstance,
    { imports, requireOrigin }: ImportRouteOptions,
  ): Promise<void> {
    const uploaded = apiSuccessSchema(uploadResultWireSchema);
    const drafted = apiSuccessSchema(importDraftWireSchema);
    const checked = apiSuccessSchema(dryRunWireSchema);
    const maybeDrafted = apiSuccessSchema(importDraftWireSchema.nullable());
    const committed = apiSuccessSchema(commitImportResultWireSchema);
    const reported = apiSuccessSchema(importReportWireSchema);
    const paged = apiSuccessSchema(importRowsPageWireSchema);
    const onRequest = async (request: FastifyRequest) => {
      await requireOrigin(request);
    };
    app.post<{ Querystring: { company?: string } }>(
      "/api/imports",
      { onRequest },
      async (request, reply) => {
        const actor = await imports.requireContext(
          request,
          routes._slug(request.query.company),
        );
        const limit = await imports.admitUpload(actor);
        if (!limit.allowed)
          return reply
            .code(429)
            .header("Retry-After", String(limit.retryAfter))
            .send({
              ok: false,
              error: "validation",
              message: `Too many uploads. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`,
            });
        const file = await request.file();
        if (!file) throw new AppError("validation", "Choose a file to upload");
        const result = await routes._withControl(reply, (control) =>
          imports.createImportBatch(
            actor,
            {
              fileName: file.filename,
              contentType: file.mimetype,
              bytes: routes._whole(file.file),
              ip: request.ip,
            },
            control,
          ),
        );
        return reply.send(
          uploaded.parse({ ok: true, data: routes._wire(result) }),
        );
      },
    );
    app.get(
      "/api/companies/:slug/imports/getUploadResult",
      async (request: BatchRequest, reply) => {
        const { actor, batchId } = await routes._batch(imports, request);
        const result = await imports.getUploadResult(actor, batchId);
        return reply.send(
          uploaded.parse({ ok: true, data: routes._wire(result) }),
        );
      },
    );
    app.get(
      "/api/companies/:slug/imports/getImportDraft",
      async (request: BatchRequest, reply) => {
        const { actor, batchId } = await routes._batch(imports, request);
        const result = await imports.getImportDraft(actor, batchId);
        return reply.send(maybeDrafted.parse({ ok: true, data: result }));
      },
    );
    app.get(
      "/api/companies/:slug/imports/getImportBatch",
      async (request: BatchRequest, reply) => {
        const { actor, batchId } = await routes._batch(imports, request);
        const result = await imports.getImportBatch(actor, batchId);
        return reply.send(
          reported.parse({
            ok: true,
            data: {
              ...result,
              createdAt: result.createdAt.toISOString(),
              startedAt: result.startedAt?.toISOString() ?? null,
              finishedAt: result.finishedAt?.toISOString() ?? null,
            },
          }),
        );
      },
    );
    app.get<{ Params: { slug: string }; Querystring: ImportRowsQuery }>(
      "/api/companies/:slug/imports/listImportRows",
      async (request, reply) => {
        const actor = await imports.requireContext(
          request,
          routes._slug(request.params.slug),
        );
        const result = await imports.listImportRows(actor, request.query);
        return reply.send(paged.parse({ ok: true, data: result }));
      },
    );
    app.post<{ Params: { slug: string }; Body: ImportDraftInput }>(
      "/api/companies/:slug/imports/saveImportDraft",
      { onRequest },
      async (request, reply) => {
        const actor = await imports.requireContext(
          request,
          routes._slug(request.params.slug),
        );
        const result = await imports.saveImportDraft(actor, request.body);
        return reply.send(drafted.parse({ ok: true, data: result }));
      },
    );
    app.post<{ Params: { slug: string }; Body: ImportDraftInput }>(
      "/api/companies/:slug/imports/dryRunImport",
      { onRequest },
      async (request, reply) => {
        const actor = await imports.requireContext(
          request,
          routes._slug(request.params.slug),
        );
        const result = await routes._withControl(reply, (control) =>
          imports.dryRunImport(actor, request.body, control),
        );
        return reply.send(checked.parse({ ok: true, data: result }));
      },
    );
    app.post<{ Params: { slug: string }; Body: CommitImportInput }>(
      "/api/companies/:slug/imports/commitImport",
      { onRequest },
      async (request, reply) => {
        const actor = await imports.requireContext(
          request,
          routes._slug(request.params.slug),
        );
        const result = await imports.commitImport(actor, request.body, {
          ip: request.ip,
        });
        return reply.send(committed.parse({ ok: true, data: result }));
      },
    );
    app.post<{ Params: { slug: string }; Body: { batchId: string } }>(
      "/api/companies/:slug/imports/resumeImport",
      { onRequest },
      async (request, reply) => {
        const actor = await imports.requireContext(
          request,
          routes._slug(request.params.slug),
        );
        const result = await imports.resumeImport(actor, request.body, {
          ip: request.ip,
        });
        return reply.send(committed.parse({ ok: true, data: result }));
      },
    );
  },

  // Aborts on client disconnect or after the deadline; either way the upload fails as unavailable.
  async _withControl<T>(
    reply: FastifyReply,
    fn: (control: ReadControl) => Promise<T>,
  ): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), deadlineMs);
    const onClose = () => {
      if (!reply.raw.writableFinished) abort.abort();
    };
    reply.raw.on("close", onClose);
    try {
      return await fn({ signal: abort.signal });
    } catch (error) {
      if (abort.signal.aborted)
        throw new AppError(
          "unavailable",
          "The file took too long or the request stopped",
        );
      throw error;
    } finally {
      clearTimeout(timer);
      reply.raw.off("close", onClose);
    }
  },
  // The multipart limit cuts the stream short without failing it, so a cut file is refused here.
  async *_whole(
    stream: AsyncIterable<Uint8Array> & { truncated: boolean },
  ): AsyncGenerator<Uint8Array> {
    yield* stream;
    if (stream.truncated)
      throw new AppError("validation", "The file is larger than 25 MB");
  },
  _slug(value: unknown): string {
    const slug = slugSchema.safeParse(value);
    if (!slug.success)
      throw new AppError("validation", "A valid company slug is required");
    return slug.data;
  },
  async _batch(imports: ImportService, request: BatchRequest) {
    const slug = routes._slug(request.params.slug);
    const query = batchIdQuerySchema.safeParse(request.query);
    if (!query.success)
      throw new AppError("validation", "A valid import is required");
    const actor = await imports.requireContext(request, slug);
    return { actor, batchId: query.data.batchId };
  },
  _wire(result: UploadResultReal) {
    return {
      ...result,
      dateRange: result.dateRange && {
        from: result.dateRange.from.toISOString(),
        to: result.dateRange.to.toISOString(),
      },
    };
  },
};
export default routes;
