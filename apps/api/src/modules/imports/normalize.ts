import { AppError } from "@anar/domain/errors";
import type { ImportIssue } from "@anar/domain/imports";
import type { Lead } from "@anar/domain/leads";
import type { Field } from "@anar/domain/settings";
import dates from "../../lib/dates.js";
import phone from "../../lib/phone.js";
import mapping from "./mapping.js";
import type { NormaliseRowInput, NormalizedRow } from "./types.js";

const sources: Record<string, NonNullable<Lead["source"]>> = {
  fb: "facebook",
  facebook: "facebook",
  ig: "instagram",
  instagram: "instagram",
};

const normalize = {
  normaliseRow(input: NormaliseRowInput): NormalizedRow {
    const { row, columns } = input;
    const issues: ImportIssue[] = [];
    const result: NormalizedRow = {
      lead: {
        fullName: null,
        phoneRaw: null,
        phoneE164: null,
        phoneValid: false,
        email: null,
        source: null,
        leadDate: input.importedAt,
        campaignName: null,
        formName: null,
        externalId: null,
        custom: {},
      },
      issues,
      newOptions: [],
      invalid: row.slice(columns.length).some((cell) => cell.trim()),
    };
    if (result.invalid)
      issues.push({
        code: "column_count",
        header: null,
        message: "The row has more cells than the header",
      });
    const indexOf = new Map(columns.map((c) => [c.header, c.index]));
    const fields = new Map(input.fields.map((f) => [f.key, f]));
    let datedBy: string | null = null;
    for (const { header, target } of input.mapping) {
      if (target === "skip") continue;
      const index = indexOf.get(header);
      const value = index === undefined ? null : row[index]?.trim() || null;
      const lead = result.lead;
      if (target === "system:full_name") lead.fullName = value;
      else if (target === "system:email") lead.email = value;
      else if (target === "system:campaign_name") lead.campaignName = value;
      else if (target === "system:form_name") lead.formName = value;
      else if (target === "system:phone") {
        Object.assign(lead, phone.normalisePhone(value, input.defaultCountry));
        if (!lead.phoneValid)
          issues.push({
            code: "invalid_phone",
            header,
            message: "The phone number is not valid",
          });
      } else if (target === "system:lead_date") {
        const parsed = dates.parseLeadDate(value, input);
        lead.leadDate = parsed.value;
        if (!parsed.issue) datedBy = header;
      } else if (target === "system:source") {
        lead.source = value ? (sources[value.toLowerCase()] ?? "other") : null;
        if (lead.source === "other")
          issues.push({
            code: "unknown_platform",
            header,
            message: `Platform "${value}" is not known`,
          });
      } else {
        const key = target.slice("field:".length);
        const field = fields.get(key);
        if (!field)
          throw new AppError("validation", `Column ${header} has no field`);
        lead.custom[key] = normalize._custom(
          field,
          value,
          header,
          input,
          result,
        );
      }
    }
    if (!datedBy)
      issues.push({
        code: "bad_date",
        header: null,
        message: "The lead date is missing or not valid",
      });
    return result;
  },
  _custom(
    field: Field,
    value: string | null,
    header: string,
    input: NormaliseRowInput,
    result: NormalizedRow,
  ): string | number | null {
    if (value === null) return null;
    if (field.type === "number") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
      result.issues.push({
        code: "invalid_number",
        header,
        message: `"${value}" is not a number`,
      });
      return null;
    }
    if (field.type === "date") {
      const parsed = dates.parseLeadDate(value, input);
      if (!parsed.issue) return dates.localDate(parsed.value, input.timezone);
      result.issues.push({
        code: "invalid_custom_date",
        header,
        message: `"${value}" is not a date`,
      });
      return null;
    }
    if (field.type === "dropdown") {
      const known = field.options?.some((option) => option.value === value);
      if (!known) {
        result.newOptions.push({
          fieldKey: field.key,
          option: { value, label: mapping.guessLabel(value) },
        });
        result.issues.push({
          code: "new_option",
          header,
          message: `"${value}" is a new answer`,
        });
      }
    }
    return value;
  },
};
export default normalize;
