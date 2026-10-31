import { type Permission, permissionSchema } from "@anar/domain/context";
import { describe, expect, it } from "vitest";
import permissions, {
  type PolicyResource,
  type PolicySubject,
} from "../../src/modules/tenant/permissions.js";

const agencyA = "a0000000-0000-4000-8000-000000000001";
const agencyB = "b0000000-0000-4000-8000-000000000001";
const companyA1 = "a1000000-0000-4000-8000-000000000001";
const companyA2 = "a2000000-0000-4000-8000-000000000001";
const companyB1 = "b1000000-0000-4000-8000-000000000001";
const memberId = "c0000000-0000-4000-8000-000000000001";
const otherMemberId = "c0000000-0000-4000-8000-000000000002";

const owner: Permission[] = [
  "agency.create",
  "agency.list",
  "agency.resend_first_invite",
  "sessions.manage_own",
];
const staff: Permission[] = [
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
const manager: Permission[] = [
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
const imports: Permission[] = ["imports.upload", "imports.commit"];
const admin: Permission[] = [
  "leads.view",
  "leads.update",
  "followups.log",
  "reports.view_own",
  "sessions.manage_own",
];
const ownAssigned = new Set<Permission>([
  "leads.view",
  "leads.update",
  "followups.log",
  "reports.view_own",
]);
const platform = new Set<Permission>([...owner]);

const company = (role: "super_admin" | "admin", canImport = false) =>
  ({
    role,
    agencyId: agencyA,
    companyId: companyA1,
    member: { id: memberId },
    superAdminCanImport: canImport,
  }) satisfies PolicySubject;

const subjects: {
  name: string;
  subject: PolicySubject;
  granted: Permission[];
  own: PolicyResource;
  access: "all" | "own";
}[] = [
  {
    name: "owner",
    subject: { role: "owner" },
    granted: owner,
    own: { agencyId: agencyA, companyId: null },
    access: "all",
  },
  {
    name: "agency staff",
    subject: { role: "agency_staff", agencyId: agencyA },
    granted: staff,
    own: { agencyId: agencyA, companyId: companyA1 },
    access: "all",
  },
  {
    name: "entered agency staff",
    subject: { role: "agency_staff", agencyId: agencyA, companyId: companyA1 },
    granted: [...manager, ...imports],
    own: { agencyId: agencyA, companyId: companyA1, assignedMemberId: null },
    access: "all",
  },
  {
    name: "Super Admin with the default import flag",
    subject: company("super_admin"),
    granted: manager,
    own: { agencyId: agencyA, companyId: companyA1, assignedMemberId: null },
    access: "all",
  },
  {
    name: "Super Admin allowed to import",
    subject: company("super_admin", true),
    granted: [...manager, ...imports],
    own: { agencyId: agencyA, companyId: companyA1, assignedMemberId: null },
    access: "all",
  },
  {
    name: "Admin",
    subject: company("admin"),
    granted: admin,
    own: {
      agencyId: agencyA,
      companyId: companyA1,
      assignedMemberId: memberId,
    },
    access: "own",
  },
];
const all = permissionSchema.options;

describe.each(subjects)("$name", ({ subject, granted, own, access }) => {
  const allowed = new Set(granted);

  it("has exactly the capabilities in the table", () => {
    expect([...permissions.capabilities(subject)].sort()).toEqual(
      [...granted].sort(),
    );
    expect(permissions.resourceAccess(subject)).toBe(access);
  });

  it.each(all)("decides %s for own, foreign and missing resources", (p) => {
    const expected = allowed.has(p);
    expect(permissions.can(subject, p)).toBe(expected);
    expect(permissions.can(subject, p, own)).toBe(expected);
    expect(permissions.can(subject, p, null)).toBe(false);
    const foreignAgency = { agencyId: agencyB, companyId: companyB1 };
    const otherCompany = { agencyId: agencyA, companyId: companyA2 };
    expect(permissions.can(subject, p, foreignAgency)).toBe(
      expected && platform.has(p),
    );
    expect(permissions.can(subject, p, otherCompany)).toBe(
      expected &&
        (platform.has(p) ||
          (subject.role === "agency_staff" && subject.companyId === undefined)),
    );
    if (expected)
      expect(() => permissions.require(subject, p, own)).not.toThrow();
    else
      expect(() => permissions.require(subject, p, own)).toThrow(
        expect.objectContaining({ code: "forbidden" }),
      );
  });
});

describe("Admin own resources", () => {
  const subject = company("admin");
  const assigned = (assignedMemberId: string | null | undefined) => ({
    agencyId: agencyA,
    companyId: companyA1,
    assignedMemberId,
  });

  it.each([...ownAssigned])(
    "allows %s only on rows assigned to the Admin",
    (p) => {
      expect(permissions.can(subject, p, assigned(memberId))).toBe(true);
      expect(permissions.can(subject, p, assigned(otherMemberId))).toBe(false);
      expect(permissions.can(subject, p, assigned(null))).toBe(false);
      expect(permissions.can(subject, p, assigned(undefined))).toBe(false);
    },
  );

  it("lets a Super Admin act on rows assigned to anyone in the company", () => {
    for (const p of ownAssigned)
      expect(
        permissions.can(company("super_admin"), p, assigned(otherMemberId)),
      ).toBe(true);
  });
});
