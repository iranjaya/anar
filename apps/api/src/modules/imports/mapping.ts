import { createHash } from "node:crypto";
import type {
  CsvProfile,
  HeaderColumn,
  Mapping,
  MappingSuggestion,
  MappingTarget,
  MappingTemplate,
  NewField,
} from "@anar/domain/imports";
import { type Field, fieldKeyFromLabel } from "@anar/domain/settings";

const synonyms: Record<string, MappingTarget> = {
  full_name: "system:full_name",
  name: "system:full_name",
  "full name": "system:full_name",
  "lead name": "system:full_name",
  phone: "system:phone",
  phone_number: "system:phone",
  mobile: "system:phone",
  contact: "system:phone",
  email: "system:email",
  "e-mail": "system:email",
  created_time: "system:lead_date",
  created: "system:lead_date",
  date: "system:lead_date",
  "lead date": "system:lead_date",
  campaign_name: "system:campaign_name",
  form_name: "system:form_name",
  platform: "system:source",
  id: "skip",
  ad_id: "skip",
  adset_id: "skip",
  adset_name: "skip",
  ad_name: "skip",
  form_id: "skip",
  is_organic: "skip",
};

const mapping = {
  synonymFor(normalized: string): MappingTarget | undefined {
    return synonyms[normalized];
  },
  normalizeHeader(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase()
      .replace(/[?_]+$/, "");
  },
  // Repeated headers get _2, _3 so every column has its own identity.
  headerColumns(cells: string[]): HeaderColumn[] {
    const seen = new Map<string, number>();
    return cells.map((original, index) => {
      const base = mapping.normalizeHeader(original);
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      const suffix = count === 1 ? "" : `_${count}`;
      return {
        index,
        original,
        header: `${original.trim()}${suffix}`,
        normalized: `${base}${suffix}`,
      };
    });
  },
  fingerprint(columns: HeaderColumn[]): string {
    const headers = [...new Set(columns.map((c) => c.normalized))].sort();
    return createHash("sha256").update(headers.join("\n")).digest("hex");
  },
  guessLabel(code: string): string {
    const text = code.replace(/_+$/, "").replace(/_/g, " ").trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
  },
  matchMapping(input: {
    profile: CsvProfile;
    fields: Field[];
    templates: MappingTemplate[];
    fileName: string;
  }): MappingSuggestion {
    const { profile, templates } = input;
    const fingerprint = mapping.fingerprint(profile.columns);
    const exact = templates.find((t) => t.headerFingerprint === fingerprint);
    const template = exact ?? mapping._sameForm(profile, templates);
    const fromTemplate = new Map(
      (template?.mapping ?? []).map((entry) => [
        mapping.normalizeHeader(entry.header),
        entry.target,
      ]),
    );
    const suggested = mapping._suggest(profile, input.fields);
    const suggestedMapping: Mapping = profile.columns.map((column) => ({
      header: column.header,
      target:
        fromTemplate.get(column.normalized) ??
        suggested.targets.get(column.header) ??
        "skip",
    }));
    const proposedFields = suggested.proposals.filter(
      (field) => !fromTemplate.has(mapping.normalizeHeader(field.header)),
    );
    const present = new Set(profile.columns.map((c) => c.normalized));
    const differs = template && !exact;
    return {
      matchedTemplate: template && { id: template.id, name: template.name },
      suggestedMapping,
      proposedFields,
      newColumns: differs
        ? profile.columns
            .filter((c) => !fromTemplate.has(c.normalized))
            .map((c) => c.header)
        : [],
      missingColumns: differs
        ? template.mapping
            .filter((e) => !present.has(mapping.normalizeHeader(e.header)))
            .map((e) => e.header)
        : [],
    };
  },
  // Only a file with one clear form name can borrow another file's template.
  _sameForm(
    profile: CsvProfile,
    templates: MappingTemplate[],
  ): MappingTemplate | undefined {
    const column = profile.columns.find(
      (c) => synonyms[c.normalized] === "system:form_name",
    );
    const kind = profile.columnKinds.find((k) => k.header === column?.header);
    if (kind?.type !== "dropdown" || kind.options.length !== 1)
      return undefined;
    const formName = kind.options[0].value;
    return templates
      .filter((t) => t.formName === formName)
      .sort(
        (a, b) =>
          (b.lastUsedAt?.getTime() ?? -1) - (a.lastUsedAt?.getTime() ?? -1) ||
          a.id.localeCompare(b.id),
      )[0];
  },
  _suggest(profile: CsvProfile, fields: Field[]) {
    const targets = new Map<string, MappingTarget>();
    const proposals: NewField[] = [];
    const used = new Set<MappingTarget>();
    const active = new Map(
      fields.filter((f) => !f.archivedAt).map((f) => [f.key, f]),
    );
    for (const column of profile.columns) {
      const key = fieldKeyFromLabel(column.normalized) ?? "";
      const synonym = synonyms[column.normalized];
      let target: MappingTarget | undefined;
      if (synonym === "skip") target = "skip";
      else if (synonym && !used.has(synonym)) target = synonym;
      else if (active.has(key) && !used.has(`field:${key}`))
        target = `field:${key}`;
      if (target) {
        if (target !== "skip") used.add(target);
        targets.set(column.header, target);
        continue;
      }
      const kind = profile.columnKinds.find((k) => k.header === column.header);
      proposals.push({
        header: column.header,
        key,
        label: mapping.guessLabel(column.original.trim()),
        type: kind?.type ?? "text",
        ...(kind?.type === "dropdown" ? { options: kind.options } : {}),
      });
      targets.set(column.header, key ? `field:${key}` : "skip");
    }
    return { targets, proposals };
  },
};
export default mapping;
