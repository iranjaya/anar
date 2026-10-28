export type Role = "super_admin" | "admin";
export type Company = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "closing";
  defaultCountry: "NP";
  timezone: "Asia/Kathmandu";
};
export type User = {
  id: string;
  email: string;
  name: string;
  platformRole: "dna" | null;
};
export type Member = {
  id: string;
  companyId: string;
  userId: string;
  name: string;
  role: Role;
  status: "invited" | "active" | "deactivated";
};
export type Ctx = {
  user: User;
  companyId: string;
  member: Member | null;
  role: Role | "dna";
  session: { id: string; actingCompanyId: string | null };
};
