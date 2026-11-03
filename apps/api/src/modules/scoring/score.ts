import type {
  ScoreInput,
  ScoreResult,
  ScoringConfig,
  ScoringRule,
} from "@anar/domain/scoring";

const score = {
  scoreLead(input: ScoreInput, config: ScoringConfig): ScoreResult {
    const breakdown: Record<string, number> = { base: config.basePoints };
    for (const rule of config.rules) {
      const points = score._rulePoints(rule, input.custom[rule.fieldKey]);
      if (points !== null) breakdown[rule.fieldKey] = points;
    }
    const total = Object.values(breakdown).reduce((sum, p) => sum + p, 0);
    return {
      score: total,
      priority: score._priority(total, config),
      breakdown,
    };
  },

  _priority(total: number, config: ScoringConfig): ScoreResult["priority"] {
    if (total >= config.hotMin) return "hot";
    if (total >= config.warmMin) return "warm";
    return "cold";
  },

  _rulePoints(
    rule: ScoringRule,
    value: string | number | null | undefined,
  ): number | null {
    if (rule.kind === "options") {
      if (typeof value !== "string" || !Object.hasOwn(rule.points, value)) {
        return null;
      }
      return rule.points[value];
    }
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const range = rule.ranges.find(
      (r) =>
        (r.min === null || value >= r.min) && (r.max === null || value < r.max),
    );
    return range ? range.points : null;
  },
};
export default score;
