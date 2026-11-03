import { readCompanyScope, type TenantTx } from "@anar/db/tenant";
import type { CompanySchema, SettingsCatalog } from "@anar/domain/settings";
import type { FastifyRequest } from "fastify";
import type { RequestMeta } from "../auth/sessions.js";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import fields, { type SettingsReferenceReader } from "./fields.js";
import type { Meta } from "./guard.js";
import lostReasons from "./lostReasons.js";
import outcomes from "./outcomes.js";
import repository from "./repository.js";
import stages from "./stages.js";

export type SettingsDeps = {
  context: Pick<
    ReturnType<typeof tenant.create>,
    "requireContext" | "withContext"
  >;
  now(): Date;
  references: SettingsReferenceReader;
};
// Every settings write runs in one company transaction with the same permission and OTP checks.
const writes = {
  createField: fields.createField,
  updateField: fields.updateField,
  archiveField: fields.archiveField,
  upsertStage: stages.upsertStage,
  reorderStages: stages.reorderStages,
  archiveStage: stages.archiveStage,
  upsertOutcome: outcomes.upsertOutcome,
  archiveOutcome: outcomes.archiveOutcome,
  upsertLostReason: lostReasons.upsertLostReason,
  archiveLostReason: lostReasons.archiveLostReason,
} satisfies Record<
  string,
  (
    tx: TenantTx,
    current: Ctx,
    input: unknown,
    meta: Meta,
    references: SettingsReferenceReader,
  ) => Promise<unknown>
>;
export type SettingsWrite = keyof typeof writes;
export const settingsWrites = Object.keys(writes) as SettingsWrite[];

export type SettingsService = {
  requireContext(
    request: Pick<FastifyRequest, "headers">,
    slug: string,
  ): Promise<Ctx>;
  loadSchema(actor: Ctx): Promise<CompanySchema>;
  getSettings(actor: Ctx): Promise<SettingsCatalog>;
  write(
    operation: SettingsWrite,
    actor: Ctx,
    input: unknown,
    meta: RequestMeta,
  ): Promise<unknown>;
};

const settings = {
  create(deps: SettingsDeps): SettingsService {
    return {
      requireContext: deps.context.requireContext,
      loadSchema(actor) {
        return deps.context.withContext(actor, (tx) => settings.loadSchema(tx));
      },
      getSettings(actor) {
        return deps.context.withContext(actor, (tx, current) => {
          permissions.require(current, "settings.manage");
          return repository.catalog(tx, false);
        });
      },
      write(operation, actor, input, meta) {
        return deps.context.withContext<unknown>(actor, (tx, current) =>
          writes[operation](
            tx,
            current,
            input,
            settings._meta(deps, meta),
            deps.references,
          ),
        );
      },
    };
  },
  _meta(deps: SettingsDeps, meta: RequestMeta): Meta {
    return { at: deps.now(), ip: meta.ip };
  },
  async loadSchema(tx: TenantTx): Promise<CompanySchema> {
    await readCompanyScope(tx);
    const catalog = await repository.catalog(tx, true);
    return {
      fields: catalog.fields,
      stages: catalog.stages.map(({ archivedAt, ...stage }) => stage),
      outcomes: catalog.outcomes.map(({ archivedAt, ...outcome }) => outcome),
      lostReasons: catalog.lostReasons.map(
        ({ archivedAt, ...reason }) => reason,
      ),
    };
  },
};
export default settings;
