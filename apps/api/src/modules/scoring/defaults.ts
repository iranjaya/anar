import { readCompanyScope, type TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import type { ScoringRule } from "@anar/domain/scoring";
import type { CompanySchema } from "@anar/domain/settings";
import { v7 } from "uuid";
import { loadSchema } from "../settings/index.js";
import repository from "./repository.js";

const basePoints = 1;
const hotMin = 8;
const warmMin = 5;
const rules: ScoringRule[] = [
  {
    fieldKey: "purchase_timeline",
    kind: "options",
    points: {
      "<15 days": 4,
      "15-30 days": 3,
      "1-3 months": 2,
      "3+ months": 1,
      within_1_month: 4,
      within_2_months: 3,
      within_3_months: 2,
      just_exploring: 1,
    },
  },
  { fieldKey: "budget_fit", kind: "options", points: { Yes: 3, Maybe: 2 } },
  {
    fieldKey: "decision_maker",
    kind: "options",
    points: { Yes: 2, Shared: 1 },
  },
];

const defaults = {
  rules,
  async seedScoringDefaults(tx: TenantTx): Promise<void> {
    const scope = await readCompanyScope(tx);
    if (!scope.userId)
      throw new Error("User scope is required to seed scoring defaults");
    if (await repository.readActive(tx, scope.companyId)) return;
    defaults._requireFields(await loadSchema(tx));
    const inserted = await repository.insert(tx, {
      id: v7(),
      companyId: scope.companyId,
      version: 1,
      basePoints,
      hotMin,
      warmMin,
      rules,
      active: true,
      createdBy: scope.userId,
    });
    if (!inserted && !(await repository.readActive(tx, scope.companyId)))
      throw new AppError("conflict", "Scoring version 1 already exists");
  },
  _requireFields(schema: CompanySchema): void {
    for (const rule of rules) {
      const field = schema.fields.find((f) => f.key === rule.fieldKey);
      const codes = new Set(field?.options?.map((option) => option.value));
      if (
        field?.type !== "dropdown" ||
        rule.kind !== "options" ||
        Object.keys(rule.points).some((code) => !codes.has(code))
      )
        throw new AppError(
          "conflict",
          `Scoring needs the ${rule.fieldKey} field with its codes`,
        );
    }
  },
};
export default defaults;
