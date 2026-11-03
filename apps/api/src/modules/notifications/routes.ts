import { slugSchema } from "@anar/domain/agencies";
import { okSchema } from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { apiSuccessSchema } from "@anar/domain/http";
import {
  type MarkReadInput,
  type NotificationQuery,
  notificationPageWireSchema,
  pushStateSchema,
  pushSubscribedSchema,
  type SubscribePushInput,
  type UnsubscribePushInput,
} from "@anar/domain/notifications";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { NotificationService } from "./service.js";

export type NotificationRouteOptions = {
  notifications: NotificationService;
  requireOrigin(request: FastifyRequest): void | Promise<void>;
};
type SlugRequest = FastifyRequest<{ Params: { slug: string } }>;

const routes = {
  async register(
    app: FastifyInstance,
    { notifications, requireOrigin }: NotificationRouteOptions,
  ): Promise<void> {
    const page = apiSuccessSchema(notificationPageWireSchema);
    const success = apiSuccessSchema(okSchema);
    const pushState = apiSuccessSchema(pushStateSchema);
    const subscribed = apiSuccessSchema(pushSubscribedSchema);
    const onRequest = async (request: FastifyRequest) => {
      await requireOrigin(request);
    };
    const iso = (date: Date | null) => date?.toISOString() ?? null;
    app.get<{ Params: { slug: string }; Querystring: NotificationQuery }>(
      "/api/companies/:slug/notifications/listNotifications",
      async (request, reply) => {
        const actor = await routes._context(notifications, request);
        const result = await notifications.listNotifications(
          actor,
          request.query,
        );
        return reply.send(
          page.parse({
            ok: true,
            data: {
              ...result,
              items: result.items.map((item) => ({
                ...item,
                readAt: iso(item.readAt),
                pushedAt: iso(item.pushedAt),
                emailedAt: iso(item.emailedAt),
                createdAt: item.createdAt.toISOString(),
              })),
            },
          }),
        );
      },
    );
    app.post<{ Params: { slug: string }; Body: MarkReadInput }>(
      "/api/companies/:slug/notifications/markRead",
      { onRequest },
      async (request, reply) => {
        const actor = await routes._context(notifications, request);
        const result = await notifications.markRead(actor, request.body, {
          ip: request.ip,
        });
        return reply.send(success.parse({ ok: true, data: result }));
      },
    );
    app.get<{ Params: { slug: string } }>(
      "/api/companies/:slug/notifications/getPushState",
      async (request, reply) => {
        const actor = await routes._context(notifications, request);
        const result = await notifications.getPushState(actor);
        return reply.send(pushState.parse({ ok: true, data: result }));
      },
    );
    app.post<{ Params: { slug: string }; Body: SubscribePushInput }>(
      "/api/companies/:slug/notifications/subscribePush",
      { onRequest },
      async (request, reply) => {
        const actor = await routes._context(notifications, request);
        const result = await notifications.subscribePush(actor, request.body, {
          ip: request.ip,
        });
        return reply.send(subscribed.parse({ ok: true, data: result }));
      },
    );
    app.post<{ Params: { slug: string }; Body: UnsubscribePushInput }>(
      "/api/companies/:slug/notifications/unsubscribePush",
      { onRequest },
      async (request, reply) => {
        const actor = await routes._context(notifications, request);
        const result = await notifications.unsubscribePush(
          actor,
          request.body,
          { ip: request.ip },
        );
        return reply.send(success.parse({ ok: true, data: result }));
      },
    );
  },

  async _context(notifications: NotificationService, request: SlugRequest) {
    const slug = slugSchema.safeParse(request.params.slug);
    if (!slug.success)
      throw new AppError("validation", "A valid company slug is required");
    return notifications.requireContext(request, slug.data);
  },
};
export default routes;
