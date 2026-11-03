import {
  fields,
  lostReasons,
  outcomes,
  readCompanyScope,
  stages,
  type TenantTx,
} from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import { v7 } from "uuid";

type Option = { value: string; label: string };

const stageSeeds = [
  { name: "New Lead", kind: "open", isDefault: true },
  { name: "Contacted", kind: "open", isDefault: false },
  { name: "Qualified", kind: "open", isDefault: false },
  { name: "Follow-up", kind: "open", isDefault: false },
  { name: "Site Visit", kind: "open", isDefault: false },
  { name: "Negotiation", kind: "open", isDefault: false },
  { name: "Booked", kind: "won", isDefault: false },
  { name: "Lost", kind: "lost", isDefault: false },
] as const;
const outcomeSeeds = [
  { name: "Connected - High Interest", countsAsFailed: false },
  { name: "Connected - Low Interest", countsAsFailed: false },
  { name: "Not Interested", countsAsFailed: true },
  { name: "No Answer", countsAsFailed: true },
  { name: "Callback Requested", countsAsFailed: true },
  { name: "Budget Discussion", countsAsFailed: false },
  { name: "Site Visit Scheduled", countsAsFailed: false },
  { name: "Site Visit Done", countsAsFailed: false },
  { name: "Negotiation Started", countsAsFailed: false },
  { name: "Document Submitted", countsAsFailed: false },
];
const reasonSeeds = [
  "Too Expensive",
  "Wrong Location",
  "Bought from Competitor",
  "Not Responding",
  "Not Genuine Lead",
  "Changed Mind",
  "Other",
];
const options = (pairs: [string, string][]): Option[] =>
  pairs.map(([value, label]) => ({ value, label }));
const fieldSeeds = [
  {
    key: "purchase_timeline",
    label: "Purchase timeline",
    options: options([
      ["<15 days", "Under 15 days"],
      ["15-30 days", "15 to 30 days"],
      ["1-3 months", "1 to 3 months"],
      ["3+ months", "Over 3 months"],
      ["within_1_month", "Within 1 month"],
      ["within_2_months", "Within 2 months"],
      ["within_3_months", "Within 3 months"],
      ["just_exploring", "Just exploring"],
    ]),
  },
  {
    key: "budget_fit",
    label: "Budget fit",
    options: options([
      ["Yes", "Yes"],
      ["Maybe", "Maybe"],
    ]),
  },
  {
    key: "decision_maker",
    label: "Decision maker",
    options: options([
      ["Yes", "Yes"],
      ["Shared", "Shared"],
    ]),
  },
];

const defaults = {
  stageSeeds,
  outcomeSeeds,
  reasonSeeds,
  fieldSeeds,
  // Callers hold the company row lock. Inserts only seeds that are missing and never resets edits.
  async seedDefaults(tx: TenantTx): Promise<void> {
    const { companyId } = await readCompanyScope(tx);
    const [stageRows, outcomeRows, reasonRows, fieldRows] = await Promise.all([
      tx.select().from(stages),
      tx.select().from(outcomes),
      tx.select().from(lostReasons),
      tx.select().from(fields),
    ]);
    const missing = <T>(
      rows: { seedKey: string | null }[],
      seeds: readonly T[],
      name: (seed: T) => string,
    ) => {
      const seeded = new Set(rows.map((row) => row.seedKey));
      return seeds.filter((seed) => !seeded.has(defaults._seedKey(name(seed))));
    };
    const after = (rows: { position: number }[]) =>
      Math.max(-1, ...rows.map((row) => row.position)) + 1;

    const hasDefault = stageRows.some((row) => row.isDefault);
    const newStages = missing(stageRows, stageSeeds, (seed) => seed.name);
    if (newStages.length > 0)
      await tx.insert(stages).values(
        newStages.map((seed, index) => ({
          id: v7(),
          companyId,
          name: seed.name,
          kind: seed.kind,
          isDefault: seed.isDefault && !hasDefault,
          seedKey: defaults._seedKey(seed.name),
          position: after(stageRows) + index,
        })),
      );
    const newOutcomes = missing(outcomeRows, outcomeSeeds, (seed) => seed.name);
    if (newOutcomes.length > 0)
      await tx.insert(outcomes).values(
        newOutcomes.map((seed, index) => ({
          id: v7(),
          companyId,
          ...seed,
          seedKey: defaults._seedKey(seed.name),
          position: after(outcomeRows) + index,
        })),
      );
    const newReasons = missing(reasonRows, reasonSeeds, (seed) => seed);
    if (newReasons.length > 0)
      await tx.insert(lostReasons).values(
        newReasons.map((seed, index) => ({
          id: v7(),
          companyId,
          name: seed,
          seedKey: defaults._seedKey(seed),
          position: after(reasonRows) + index,
        })),
      );

    const byKey = new Map(fieldRows.map((row) => [row.key, row]));
    const newFields = fieldSeeds.filter((seed) => {
      const existing = byKey.get(seed.key);
      if (!existing) return true;
      const codes = new Set(existing.options?.map((option) => option.value));
      if (
        existing.type !== "dropdown" ||
        seed.options.some((option) => !codes.has(option.value))
      )
        throw new AppError(
          "conflict",
          `The ${seed.key} field no longer matches its default`,
        );
      return false;
    });
    if (newFields.length > 0)
      await tx.insert(fields).values(
        newFields.map((seed, index) => ({
          id: v7(),
          companyId,
          ...seed,
          type: "dropdown" as const,
          isSystem: false,
          position: after(fieldRows) + index,
        })),
      );
  },
  _seedKey(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  },
};
export default defaults;
