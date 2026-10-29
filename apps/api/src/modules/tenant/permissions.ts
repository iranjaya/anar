import type { Permission } from "@anar/domain/agencies";

const permissions = {
  agencyCapabilities(actor: { role: "owner" | "agency_staff" }): Permission[] {
    return [...permissions._agencyCapabilities[actor.role]];
  },
  _agencyCapabilities: {
    owner: [],
    agency_staff: [
      "agency.staff.list",
      "company.create",
      "company.list",
      "members.invite_super_admin",
      "sessions.manage_own",
    ],
  } satisfies Record<"owner" | "agency_staff", Permission[]>,
};
export default permissions;
