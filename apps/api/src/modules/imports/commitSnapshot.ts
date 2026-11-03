import { createHash } from "node:crypto";
import type { Mapping, NewField, Option } from "@anar/domain/imports";
import type { Field, FieldOptionAddition } from "@anar/domain/settings";
import type { CommitSnapshot } from "./types.js";

export type SettingsPlan = {
  newFields: Omit<NewField, "header">[];
  additions: FieldOptionAddition[];
};
type Company = { defaultCountry: string; timezone: string };
type HashInput = {
  fileSha256: string;
  mapping: Mapping;
  plan: SettingsPlan;
  company: Company;
};

const commitSnapshot = {
  // A new dropdown takes the answers the file adds; an existing field gets an addition.
  plan(
    newFields: NewField[],
    newOptions: { fieldKey: string; option: Option }[],
  ): SettingsPlan {
    // Built in a fixed key order: drafts and checks come back from jsonb with their keys sorted.
    const option = ({ value, label }: Option) => ({ value, label });
    const found = new Map<string, Option[]>();
    for (const proposal of newOptions)
      found.set(proposal.fieldKey, [
        ...(found.get(proposal.fieldKey) ?? []),
        option(proposal.option),
      ]);
    const added = new Set(newFields.map((field) => field.key));
    return {
      newFields: newFields.map(({ key, label, type, options }) =>
        type === "dropdown"
          ? {
              key,
              label,
              type,
              options: [
                ...(options ?? []).map(option),
                ...(found.get(key) ?? []),
              ],
            }
          : { key, label, type },
      ),
      additions: [...found]
        .filter(([fieldKey]) => !added.has(fieldKey))
        .map(([fieldKey, options]) => ({ fieldKey, options })),
    };
  },
  schemaFingerprint(fields: Field[], company: Company): string {
    const definitions = [...fields]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(({ key, type, options }) => ({ key, type, options }));
    return createHash("sha256")
      .update(
        JSON.stringify({
          definitions,
          country: company.defaultCountry,
          timezone: company.timezone,
        }),
      )
      .digest("hex");
  },
  changesSettings(plan: SettingsPlan): boolean {
    return plan.newFields.length > 0 || plan.additions.length > 0;
  },
  hash(input: HashInput): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          fileSha256: input.fileSha256,
          mapping: input.mapping,
          newFields: input.plan.newFields,
          additions: input.plan.additions,
          country: input.company.defaultCountry,
          timezone: input.company.timezone,
        }),
      )
      .digest("hex");
  },
  create(input: HashInput & { schemaFingerprint: string }): CommitSnapshot {
    return {
      fileSha256: input.fileSha256,
      schemaFingerprint: input.schemaFingerprint,
      commitHash: commitSnapshot.hash(input),
    };
  },
};
export default commitSnapshot;
