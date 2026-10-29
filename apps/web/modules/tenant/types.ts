import type { Member, Role, User } from "@anar/domain/tenant";

export type {
  Company,
  Member,
  Role,
  User,
} from "@anar/domain/tenant";

export type DemoUser = {
  id: string;
  name: string;
  role: Role | "dna";
  companyName: string | null;
};
export type Ctx = {
  user: User;
  companyId: string;
  member: Member | null;
  role: Role | "dna";
  session: { id: string; actingCompanyId: string | null };
};
