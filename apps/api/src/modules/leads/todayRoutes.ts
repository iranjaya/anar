import { slugSchema } from "@anar/domain/agencies";
import { AppError } from "@anar/domain/errors";
import { apiSuccessSchema } from "@anar/domain/http";
import {
  type BucketQuery,
  bucketCountsWireSchema,
  bucketPageWireSchema,
  type LeadRow,
  memberIdQuerySchema,
  todayResultWireSchema,
} from "@anar/domain/leads";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Ctx } from "../tenant/index.js";
import type { TodayService } from "./today.js";

export type TodayRouteOptions = { today: TodayService };
type SlugRequest = FastifyRequest<{ Params: { slug: string } }>;
const iso = (date: Date | null) => date?.toISOString() ?? null;

const todayRoutes = {
  async register(
    app: FastifyInstance,
    { today }: TodayRouteOptions,
  ): Promise<void> {
    const result = apiSuccessSchema(todayResultWireSchema);
    const page = apiSuccessSchema(bucketPageWireSchema);
    const counted = apiSuccessSchema(bucketCountsWireSchema);
    app.get(
      "/api/companies/:slug/leads/getMyToday",
      async (request: SlugRequest, reply) => {
        const data = await today.getMyToday(
          await todayRoutes._context(today, request),
        );
        return reply.send(
          result.parse({
            ok: true,
            data: {
              ...data,
              overdue: data.overdue.map(todayRoutes._row),
              dueToday: data.dueToday.map(todayRoutes._row),
              newLeads: data.newLeads.map(todayRoutes._row),
              counts: { ...data.counts, nextDueAt: iso(data.counts.nextDueAt) },
            },
          }),
        );
      },
    );
    app.get<{ Params: { slug: string }; Querystring: BucketQuery }>(
      "/api/companies/:slug/leads/listTodayBucket",
      async (request, reply) => {
        const data = await today.listTodayBucket(
          await todayRoutes._context(today, request),
          request.query,
        );
        return reply.send(
          page.parse({
            ok: true,
            data: { ...data, items: data.items.map(todayRoutes._row) },
          }),
        );
      },
    );
    app.get<{ Params: { slug: string }; Querystring: { memberId?: string } }>(
      "/api/companies/:slug/leads/getBucketCounts",
      async (request, reply) => {
        const actor = await todayRoutes._context(today, request);
        const query = memberIdQuerySchema.safeParse(request.query);
        if (!query.success)
          throw new AppError("validation", "Choose a team member");
        const data = await today.getBucketCounts(actor, query.data.memberId);
        return reply.send(counted.parse({ ok: true, data }));
      },
    );
  },

  async _context(
    service: {
      requireContext(request: SlugRequest, slug: string): Promise<Ctx>;
    },
    request: SlugRequest,
  ): Promise<Ctx> {
    const slug = slugSchema.safeParse(request.params.slug);
    if (!slug.success)
      throw new AppError("validation", "A valid company slug is required");
    return service.requireContext(request, slug.data);
  },

  _row(row: LeadRow) {
    return {
      ...row,
      nextActionAt: iso(row.nextActionAt),
      leadDate: row.leadDate.toISOString(),
      assignedAt: iso(row.assignedAt),
    };
  },
};
export default todayRoutes;
