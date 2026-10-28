import { describe, expect, it } from "vitest";
import type { Permission } from "./permissions";
import { can } from "./server";
import type { Ctx } from "./types";

function context(role: Ctx["role"]): Ctx {
  return {
    user: {
      id: "user",
      email: "demo@example.test",
      name: "Demo User",
      platformRole: role === "dna" ? "dna" : null,
    },
    companyId: "sundar-heights",
    member:
      role === "dna"
        ? null
        : {
            id: "member",
            companyId: "sundar-heights",
            userId: "user",
            name: "Demo User",
            role,
            status: "active",
          },
    role,
    session: {
      id: "demo",
      actingCompanyId: role === "dna" ? "sundar-heights" : null,
    },
  };
}

const matrix: {
  permission: Permission;
  allowed: [boolean, boolean, boolean, boolean];
}[] = [
  { permission: "company.create", allowed: [true, false, false, false] },
  { permission: "company.list", allowed: [true, false, false, false] },
  { permission: "company.enter", allowed: [true, false, false, false] },
  {
    permission: "members.invite_super_admin",
    allowed: [true, false, false, false],
  },
  { permission: "members.invite_admin", allowed: [true, true, false, false] },
  { permission: "members.deactivate", allowed: [true, true, false, false] },
  { permission: "members.list", allowed: [true, true, false, false] },
  { permission: "settings.manage", allowed: [true, true, false, false] },
  { permission: "imports.upload", allowed: [true, false, false, false] },
  { permission: "imports.commit", allowed: [true, false, false, false] },
  { permission: "leads.view", allowed: [true, true, true, false] },
  { permission: "leads.assign", allowed: [true, true, false, false] },
  { permission: "leads.bulk", allowed: [true, true, false, false] },
  { permission: "leads.update", allowed: [true, true, true, false] },
  { permission: "leads.merge", allowed: [true, true, false, false] },
  { permission: "leads.export", allowed: [true, true, false, false] },
  { permission: "followups.log", allowed: [true, true, true, false] },
  { permission: "reports.view_all", allowed: [true, true, false, false] },
  { permission: "reports.compare", allowed: [true, true, false, false] },
  { permission: "reports.view_own", allowed: [true, true, true, true] },
  { permission: "sessions.manage_own", allowed: [true, true, true, true] },
];

describe("permissions", () => {
  describe.each([
    { role: "dna", ownColumn: 0, foreignColumn: 0 },
    { role: "super_admin", ownColumn: 1, foreignColumn: 1 },
    { role: "admin", ownColumn: 2, foreignColumn: 3 },
  ] as const)("$role", ({ role, ownColumn, foreignColumn }) => {
    it.each(matrix)(
      "checks $permission on own and foreign leads",
      ({ permission, allowed }) => {
        const ctx = context(role);
        expect(can(ctx, permission, { assignedTo: "member" })).toBe(
          allowed[ownColumn],
        );
        expect(can(ctx, permission, { assignedTo: "other-member" })).toBe(
          allowed[foreignColumn],
        );
        expect(can(ctx, permission, { assignedTo: null })).toBe(
          allowed[foreignColumn],
        );
        expect(can(ctx, permission)).toBe(allowed[foreignColumn]);
      },
    );
  });

  it.each(["leads.view", "leads.update", "followups.log"] as const)(
    "refuses %s for an Admin without a membership",
    (permission) => {
      expect(
        can({ ...context("admin"), member: null }, permission, {
          assignedTo: "member",
        }),
      ).toBe(false);
    },
  );
});
