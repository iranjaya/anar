import type {
  AgencyInvitePage,
  AgencyListQuery,
  AgencyStaffPage,
  AgencyView,
} from "@anar/domain/agencies";
import { AppError } from "@anar/domain/errors";
import type { FastifyRequest } from "fastify";
import invites from "../auth/invites.js";
import profiles from "../auth/profiles.js";
import permissions from "../tenant/permissions.js";
import type context from "./context.js";
import pagination from "./pagination.js";
import repository from "./repository.js";
import type { AgencyCtx } from "./service.js";

export type StaffService = {
  requireAgencyContext(
    request: Pick<FastifyRequest, "headers">,
  ): Promise<AgencyCtx>;
  getAgency(actor: AgencyCtx): Promise<AgencyView>;
  listStaff(actor: AgencyCtx, query: AgencyListQuery): Promise<AgencyStaffPage>;
  listStaffInvites(
    actor: AgencyCtx,
    query: AgencyListQuery,
  ): Promise<AgencyInvitePage>;
};
const staff = {
  create(agencyContext: ReturnType<typeof context.create>): StaffService {
    return {
      requireAgencyContext: agencyContext.requireAgencyContext,
      getAgency(actor) {
        return agencyContext.withAgencyContext(actor, async (_tx, current) => ({
          agency: {
            id: current.agency.id,
            name: current.agency.name,
            slug: current.agency.slug,
            status: current.agency.status,
            createdAt: current.agency.createdAt,
          },
          staff: {
            ...current.staff,
            name: current.user.name,
            email: current.user.email,
          },
          capabilities: permissions.agencyCapabilities(current),
        }));
      },
      listStaff(actor, query) {
        const cursor = pagination.cursor(query);
        return agencyContext.withAgencyContext(actor, async (tx, current) => {
          const page = pagination.page(
            await repository.listStaff(tx, current.agencyId, cursor),
          );
          const users = new Map(
            (
              await profiles.read(
                tx,
                page.items.map((member) => member.userId),
              )
            ).map((user) => [user.id, user]),
          );
          const items = page.items.map((member) => {
            const user = users.get(member.userId);
            if (!user)
              throw new AppError(
                "unavailable",
                "Staff identity is unavailable",
              );
            return { ...member, name: user.name, email: user.email };
          });
          return { items, nextCursor: page.nextCursor };
        });
      },
      listStaffInvites(actor, query) {
        const cursor = pagination.cursor(query);
        return agencyContext.withAgencyContext(actor, async (tx, current) =>
          pagination.page(
            await invites.listStaffInvites(tx, current.agencyId, cursor),
          ),
        );
      },
    };
  },
};
export default staff;
