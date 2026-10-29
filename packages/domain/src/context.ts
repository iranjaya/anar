import { z } from "zod";
import {
  type Agency,
  type AgencyCompany,
  agencyCompanySchema,
  agencySchema,
  slugSchema,
} from "./agencies.js";
import {
  type SessionUser,
  sessionStateViewSchema,
  sessionUserSchema,
} from "./auth.js";
import { type Permission, permissionSchema } from "./permissions.js";
import type { Member } from "./tenant.js";

export { type Permission, permissionSchema } from "./permissions.js";

export const contextQuerySchema = z.strictObject({ company: slugSchema });
export const contextMemberSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  role: z.enum(["super_admin", "admin"]),
  status: z.enum(["invited", "active", "deactivated"]),
});
export const contextSessionSchema = sessionStateViewSchema.pick({
  id: true,
  actingCompanyId: true,
  actingReason: true,
  actingUntil: true,
});
export const contextViewSchema = z.strictObject({
  agencyId: z.uuid(),
  agency: agencySchema,
  companyId: z.uuid(),
  company: agencyCompanySchema,
  user: sessionUserSchema,
  member: contextMemberSchema.nullable(),
  role: z.enum(["agency_staff", "super_admin", "admin"]),
  session: contextSessionSchema,
  capabilities: z.array(permissionSchema),
  resourceAccess: z.enum(["all", "own"]),
});
export type ContextView = {
  agencyId: string;
  agency: Agency;
  companyId: string;
  company: AgencyCompany;
  user: SessionUser;
  member: Member | null;
  role: "agency_staff" | "super_admin" | "admin";
  session: {
    id: string;
    actingCompanyId: string | null;
    actingReason: string | null;
    actingUntil: Date | null;
  };
  capabilities: Permission[];
  resourceAccess: "all" | "own";
};
