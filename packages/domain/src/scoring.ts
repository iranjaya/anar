import { z } from "zod";
import type { Priority } from "./leads.js";

const pointsSchema = z.number().int().nonnegative();
const fieldKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/)
  .refine((key) => key !== "base", "base is reserved");

const rangeSchema = z
  .strictObject({
    min: z.number().finite().nullable(),
    max: z.number().finite().nullable(),
    points: pointsSchema,
  })
  .refine(
    (range) =>
      range.min === null || range.max === null || range.min < range.max,
    "min must be below max",
  );

export const scoringRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    fieldKey: fieldKeySchema,
    kind: z.literal("options"),
    points: z.record(z.string().min(1).max(120), pointsSchema),
  }),
  z.strictObject({
    fieldKey: fieldKeySchema,
    kind: z.literal("range"),
    ranges: z
      .array(rangeSchema)
      .min(1)
      .refine(noOverlap, "ranges must not overlap"),
  }),
]);
export type ScoringRule = z.infer<typeof scoringRuleSchema>;

export const scoringConfigSchema = z
  .strictObject({
    id: z.uuid(),
    companyId: z.uuid(),
    version: z.number().int().min(1),
    basePoints: pointsSchema,
    hotMin: pointsSchema,
    warmMin: pointsSchema,
    rules: z
      .array(scoringRuleSchema)
      .refine(
        (rules) =>
          new Set(rules.map((rule) => rule.fieldKey)).size === rules.length,
        "one rule per field",
      ),
    active: z.boolean(),
  })
  .refine((config) => config.warmMin < config.hotMin, {
    message: "warmMin must be below hotMin",
    path: ["warmMin"],
  });
export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

export type ScoreInput = { custom: Record<string, string | number | null> };
export type ScoreResult = {
  score: number;
  priority: Priority;
  breakdown: Record<string, number>;
};

function noOverlap(ranges: { min: number | null; max: number | null }[]) {
  const sorted = [...ranges].sort(
    (a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity),
  );
  return sorted.every((range, i) => {
    if (i === 0) return true;
    const previousMax = sorted[i - 1].max;
    return (
      previousMax !== null && range.min !== null && previousMax <= range.min
    );
  });
}
