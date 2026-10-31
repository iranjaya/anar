import type { Permission } from "@anar/domain/agencies";
import { AppError } from "@anar/domain/errors";

export type PolicySubject =
  | { role: "owner" }
  | { role: "agency_staff"; agencyId: string; companyId?: string }
  | {
      role: "super_admin" | "admin";
      agencyId: string;
      companyId: string;
      member: { id: string };
      superAdminCanImport: boolean;
    };
export type PolicyResource = {
  agencyId: string;
  companyId: string | null;
  assignedMemberId?: string | null;
};

const imports: Permission[] = ["imports.upload", "imports.commit"];
const managed: Permission[] = [
  "members.invite_admin",
  "members.deactivate",
  "members.list",
  "settings.manage",
  "leads.assign",
  "leads.bulk",
  "leads.merge",
  "leads.export",
  "leads.view",
  "leads.update",
  "followups.log",
  "reports.view_all",
  "reports.compare",
  "reports.view_own",
  "sessions.manage_own",
];
const ownAssigned = new Set<Permission>([
  "leads.view",
  "leads.update",
  "followups.log",
  "reports.view_own",
]);
const platform = new Set<Permission>([
  "agency.create",
  "agency.list",
  "agency.resend_first_invite",
  "sessions.manage_own",
]);

const permissions = {
  capabilities(subject: PolicySubject): Permission[] {
    if (subject.role === "owner")
      return [
        "agency.create",
        "agency.list",
        "agency.resend_first_invite",
        "sessions.manage_own",
      ];
    if (subject.role === "agency_staff" && subject.companyId === undefined)
      return [
        "agency.staff.list",
        "agency.staff.invite",
        "agency.staff.resend",
        "agency.staff.deactivate",
        "company.create",
        "company.list",
        "company.enter",
        "members.invite_super_admin",
        "sessions.manage_own",
      ];
    if (subject.role === "admin")
      return [...ownAssigned, "sessions.manage_own"];
    if (subject.role === "super_admin" && !subject.superAdminCanImport)
      return managed;
    return [...managed, ...imports];
  },

  resourceAccess(subject: PolicySubject): "all" | "own" {
    return subject.role === "admin" ? "own" : "all";
  },

  // A null resource is a row that was not found, which never grants access.
  can(
    subject: PolicySubject,
    permission: Permission,
    resource?: PolicyResource | null,
  ): boolean {
    if (!permissions.capabilities(subject).includes(permission)) return false;
    if (resource === null) return false;
    if (resource === undefined || platform.has(permission)) return true;
    if (subject.role === "owner" || resource.agencyId !== subject.agencyId)
      return false;
    if (
      subject.companyId !== undefined &&
      resource.companyId !== subject.companyId
    )
      return false;
    if (subject.role === "admin" && ownAssigned.has(permission))
      return resource.assignedMemberId === subject.member.id;
    return true;
  },

  require(
    subject: PolicySubject,
    permission: Permission,
    resource?: PolicyResource | null,
  ): void {
    if (!permissions.can(subject, permission, resource))
      throw new AppError("forbidden", "This action is not allowed");
  },
};
export default permissions;
