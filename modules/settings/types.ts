export type Field = {
  id: string;
  companyId: string;
  key: string;
  label: string;
  type: "text" | "number" | "date" | "dropdown";
  options: { value: string; label: string }[] | null;
  isSystem: boolean;
  position: number;
  archivedAt: Date | null;
};
export type Stage = {
  id: string;
  companyId: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
  isDefault: boolean;
};
export type Outcome = {
  id: string;
  companyId: string;
  name: string;
  countsAsFailed: boolean;
  position: number;
};
export type LostReason = {
  id: string;
  companyId: string;
  name: string;
  position: number;
};
export type CompanySchema = {
  fields: Field[];
  stages: Stage[];
  outcomes: Outcome[];
  lostReasons: LostReason[];
};
