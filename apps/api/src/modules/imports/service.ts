import type { TenantTx } from "@anar/db/tenant";
import type {
  CommitImportInput,
  CommitImportResult,
  DryRunResult,
  ImportDraft,
  ImportDraftInput,
  ImportReport,
  ImportRowsPage,
  ImportRowsQuery,
  UploadResultReal,
} from "@anar/domain/imports";
import type { FindImportMatchesInput, ImportMatch } from "@anar/domain/leads";
import type {
  CompanySchema,
  CreateFieldsInput,
  Field,
  FieldOptionAddition,
} from "@anar/domain/settings";
import type { FastifyRequest } from "fastify";
import type { enqueue } from "../../lib/jobs/index.js";
import type { RateLimitResult, UploadLimiter } from "../auth/rateLimits.js";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import commit from "./commit.js";
import draft from "./draft.js";
import preview from "./preview.js";
import report from "./report.js";
import resume from "./resume.js";
import type { ReadControl } from "./types.js";
import upload, { type UploadInput } from "./upload.js";

export type ImportDeps = {
  context: Pick<
    ReturnType<typeof tenant.create>,
    "requireContext" | "withContext"
  >;
  uploadsRoot: string;
  limitUpload: UploadLimiter;
  loadSchema(tx: TenantTx): Promise<CompanySchema>;
  findImportMatches(
    tx: TenantTx,
    input: FindImportMatchesInput,
  ): Promise<ImportMatch[]>;
  now(): Date;
  createFields(
    tx: TenantTx,
    current: Ctx,
    input: CreateFieldsInput,
    meta: WriteMeta,
  ): Promise<Field[]>;
  extendFieldOptions(
    tx: TenantTx,
    current: Ctx,
    input: FieldOptionAddition[],
    meta: WriteMeta,
  ): Promise<void>;
  fieldKeys(tx: TenantTx): Promise<string[]>;
  enqueue: typeof enqueue;
};
type WriteMeta = { at: Date; ip: string | null };
export type ImportService = {
  requireContext(
    request: Pick<FastifyRequest, "headers">,
    slug: string,
  ): Promise<Ctx>;
  admitUpload(actor: Ctx): Promise<RateLimitResult>;
  createImportBatch(
    actor: Ctx,
    input: UploadInput,
    control: ReadControl,
  ): Promise<UploadResultReal>;
  getUploadResult(actor: Ctx, batchId: string): Promise<UploadResultReal>;
  getImportDraft(actor: Ctx, batchId: string): Promise<ImportDraft | null>;
  saveImportDraft(actor: Ctx, input: ImportDraftInput): Promise<ImportDraft>;
  dryRunImport(
    actor: Ctx,
    input: ImportDraftInput,
    control: ReadControl,
  ): Promise<DryRunResult>;
  commitImport(
    actor: Ctx,
    input: CommitImportInput,
    request: { ip: string | null },
  ): Promise<CommitImportResult>;
  getImportBatch(actor: Ctx, batchId: string): Promise<ImportReport>;
  listImportRows(actor: Ctx, input: ImportRowsQuery): Promise<ImportRowsPage>;
  resumeImport(
    actor: Ctx,
    input: { batchId: string },
    request: { ip: string | null },
  ): Promise<CommitImportResult>;
};

const service = {
  create(deps: ImportDeps): ImportService {
    return {
      requireContext: deps.context.requireContext,
      admitUpload: (actor) => upload.admitUpload(deps, actor),
      createImportBatch: (actor, input, control) =>
        upload.createImportBatch(deps, actor, input, control),
      getUploadResult: (actor, batchId) =>
        upload.getUploadResult(deps, actor, batchId),
      getImportDraft: (actor, batchId) =>
        draft.getImportDraft(deps, actor, batchId),
      saveImportDraft: (actor, input) =>
        draft.saveImportDraft(deps, actor, input),
      dryRunImport: (actor, input, control) =>
        preview.dryRunImport(deps, actor, input, control),
      commitImport: (actor, input, request) =>
        commit.commitImport(deps, actor, input, request),
      getImportBatch: (actor, batchId) =>
        report.getImportBatch(deps, actor, batchId),
      listImportRows: (actor, input) =>
        report.listImportRows(deps, actor, input),
      resumeImport: (actor, input, request) =>
        resume.resumeImport(deps, actor, input, request),
    };
  },
};
export default service;
