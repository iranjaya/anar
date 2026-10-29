import type { Member } from "./tenant.js";

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
