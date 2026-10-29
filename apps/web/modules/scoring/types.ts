export type ScoringRule = {
  fieldKey: string;
  kind: "options";
  points: Record<string, number>;
};
export type ScoringConfig = {
  id: string;
  companyId: string;
  version: number;
  basePoints: number;
  hotMin: number;
  warmMin: number;
  rules: ScoringRule[];
  active: boolean;
};
