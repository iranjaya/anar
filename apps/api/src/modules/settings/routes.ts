import { slugSchema } from "@anar/domain/agencies";
import { emptySchema, okSchema } from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { apiSuccessSchema } from "@anar/domain/http";
import {
  companySchemaSchema,
  fieldIdSchema,
  settingsCatalogSchema,
} from "@anar/domain/settings";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type SettingsService, settingsWrites } from "./service.js";

export type SettingsRouteOptions = {
  settings: SettingsService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};
type SlugRequest = FastifyRequest<{ Params: { slug: string } }>;

const routes = {
  async register(
    app: FastifyInstance,
    { settings, requireOrigin }: SettingsRouteOptions,
  ): Promise<void> {
    const schema = apiSuccessSchema(companySchemaSchema);
    const catalog = apiSuccessSchema(settingsCatalogSchema);
    const created = apiSuccessSchema(fieldIdSchema);
    const done = apiSuccessSchema(okSchema);
    const onRequest = async (request: FastifyRequest) => {
      await requireOrigin(request);
    };
    app.get<{ Params: { slug: string } }>(
      "/api/companies/:slug/settings/loadSchema",
      async (request, reply) => {
        const actor = await routes._context(settings, request);
        const data = await settings.loadSchema(actor);
        return reply.send(schema.parse({ ok: true, data }));
      },
    );
    app.get<{ Params: { slug: string } }>(
      "/api/companies/:slug/settings/getSettings",
      async (request, reply) => {
        const actor = await routes._context(settings, request);
        const data = await settings.getSettings(actor);
        return reply.send(
          catalog.parse({
            ok: true,
            data: {
              fields: data.fields.map(routes._wireArchive),
              stages: data.stages.map(routes._wireArchive),
              outcomes: data.outcomes.map(routes._wireArchive),
              lostReasons: data.lostReasons.map(routes._wireArchive),
            },
          }),
        );
      },
    );
    for (const operation of settingsWrites)
      app.post<{ Params: { slug: string } }>(
        `/api/companies/:slug/settings/${operation}`,
        { onRequest },
        async (request, reply) => {
          const actor = await routes._context(settings, request);
          const data = await settings.write(operation, actor, request.body, {
            ip: request.ip,
          });
          const result = operation === "createField" ? created : done;
          return reply.send(result.parse({ ok: true, data }));
        },
      );
  },

  _wireArchive<T extends { archivedAt: Date | null }>(row: T) {
    return { ...row, archivedAt: row.archivedAt?.toISOString() ?? null };
  },

  async _context(settings: SettingsService, request: SlugRequest) {
    const slug = slugSchema.safeParse(request.params.slug);
    if (!slug.success || !emptySchema.safeParse(request.query).success)
      throw new AppError("validation", "A valid company slug is required");
    return settings.requireContext(request, slug.data);
  },
};
export default routes;
