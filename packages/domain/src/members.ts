import { z } from "zod";
import { wireDateSchema } from "./http.js";
import { emailSchema } from "./identity.js";
import type { Member } from "./tenant.js";

export const memberViewSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  userId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  role: z.enum(["super_admin", "admin"]),
  status: z.enum(["invited", "active", "deactivated"]),
  email: emailSchema,
  openLeads: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
});
export const memberListSchema = z.array(memberViewSchema);
export type MemberView = Member & {
  email: string;
  openLeads: number;
  overdue: number;
};

export const pendingInviteSchema = z.strictObject({
  id: z.uuid(),
  email: emailSchema,
  name: memberViewSchema.shape.name,
  role: z.enum(["super_admin", "admin"]),
  expiresAt: wireDateSchema,
});
export const pendingInviteListSchema = z.array(pendingInviteSchema);

export const inviteAdminSchema = z.strictObject({
  email: emailSchema,
  name: memberViewSchema.shape.name,
});
export type InviteAdminInput = z.infer<typeof inviteAdminSchema>;

export const deactivateMemberSchema = z.strictObject({
  memberId: z.uuid(),
  reassignTo: z.uuid().optional(),
});
export type DeactivateMemberInput = z.infer<typeof deactivateMemberSchema>;
export const deactivateMemberResultSchema = z.strictObject({
  reassigned: z.number().int().nonnegative(),
});
export type DeactivateMemberResult = z.infer<
  typeof deactivateMemberResultSchema
>;
export const agencyEntrySchema = z.strictObject({
  id: z.uuid(),
  staffName: z.string(),
  reason: z.string(),
  enteredAt: wireDateSchema,
});
export const agencyEntryListSchema = z.array(agencyEntrySchema);
export type AgencyEntry = Omit<
  z.infer<typeof agencyEntrySchema>,
  "enteredAt"
> & { enteredAt: Date };

export type PendingInvite = Omit<
  z.infer<typeof pendingInviteSchema>,
  "expiresAt"
> & { expiresAt: Date };

export type CompanyMember = Member & {
  agencyId: string;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ActivateInvitedMemberInput = {
  agencyId: string;
  companyId: string;
  userId: string;
  name: string;
  role: Member["role"];
  at: Date;
};
