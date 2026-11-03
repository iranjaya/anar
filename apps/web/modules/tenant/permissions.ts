import type { Ctx } from "./types";

const permissions = {
  "company.create": "dna",
  "company.list": "dna",
  "company.enter": "dna",
  "members.invite_super_admin": "dna",
  "members.invite_admin": "manager",
  "members.deactivate": "manager",
  "members.list": "manager",
  "settings.manage": "manager",
  "imports.upload": "dna",
  "imports.commit": "dna",
  "leads.view": "own",
  "leads.assign": "manager",
  "leads.bulk": "manager",
  "leads.update": "own",
  "leads.merge": "manager",
  "leads.export": "manager",
  "followups.log": "own",
  "reports.view_all": "manager",
  "reports.compare": "manager",
  "reports.view_own": "all",
  "sessions.manage_own": "all",
} as const;

export type Permission = keyof typeof permissions;

export function isDemoPermission(permission: string): permission is Permission {
  return Object.hasOwn(permissions, permission);
}

export function can(
  ctx: Ctx,
  permission: Permission,
  resource?: { assignedTo: string | null },
): boolean {
  switch (permissions[permission]) {
    case "all":
      return true;
    case "dna":
      return ctx.role === "dna";
    case "manager":
      return ctx.role === "dna" || ctx.role === "super_admin";
    case "own":
      if (ctx.role !== "admin") return true;
      return (
        ctx.member !== null &&
        resource !== undefined &&
        resource.assignedTo === ctx.member.id
      );
  }
}

export function homeFor(ctx: Ctx): string {
  if (ctx.role === "dna") {
    if (!ctx.session.actingCompanyId) return "/companies";
    return `/${ctx.companyId}/imports/new`;
  }
  if (ctx.role === "super_admin") return `/${ctx.companyId}/dashboard`;
  return `/${ctx.companyId}/today`;
}
