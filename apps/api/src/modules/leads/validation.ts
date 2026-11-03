import { AppError } from "@anar/domain/errors";
import type { Lead, UpdateLeadFieldsInput } from "@anar/domain/leads";
import type { Field } from "@anar/domain/settings";
import phone from "../../lib/phone.js";

type SystemKey = "fullName" | "phoneRaw" | "email";
type Value = string | number | null;
export type LeadPatch = {
  set: Partial<
    Pick<Lead, "fullName" | "phoneRaw" | "phoneE164" | "phoneValid" | "email">
  >;
  custom: Lead["custom"] | null;
  keys: string[];
  systemKeys: SystemKey[];
};
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

const validation = {
  // Only values that differ from the stored lead count as changes; the rest is a no-op.
  patch(
    lead: Lead,
    input: Omit<UpdateLeadFieldsInput, "leadId">,
    fields: Field[],
    country: string,
  ): LeadPatch {
    const patch: LeadPatch = {
      set: {},
      custom: null,
      keys: [],
      systemKeys: [],
    };
    if (input.fullName !== undefined && input.fullName !== lead.fullName) {
      patch.set.fullName = input.fullName;
      patch.systemKeys.push("fullName");
    }
    if (input.phoneRaw !== undefined && input.phoneRaw !== lead.phoneRaw) {
      Object.assign(patch.set, phone.normalisePhone(input.phoneRaw, country));
      patch.systemKeys.push("phoneRaw");
    }
    if (input.email !== undefined && input.email !== lead.email) {
      patch.set.email = input.email;
      patch.systemKeys.push("email");
    }
    const changes: Record<string, Value> = {};
    for (const [key, value] of Object.entries(input.custom ?? {})) {
      const field = fields.find((field) => field.key === key);
      if (!field || field.isSystem || field.archivedAt !== null)
        throw new AppError("validation", `${key} is not a field you can edit`);
      validation._checkValue(field, value);
      if (value !== (lead.custom[key] ?? null)) changes[key] = value;
    }
    patch.keys = Object.keys(changes);
    if (patch.keys.length) patch.custom = { ...lead.custom, ...changes };
    return patch;
  },

  _checkValue(field: Field, value: Value): void {
    if (value === null || validation._fits(field, value)) return;
    throw new AppError("validation", `${field.label} is not valid`);
  },

  _fits(field: Field, value: string | number): boolean {
    switch (field.type) {
      case "text":
        return typeof value === "string";
      case "number":
        return typeof value === "number";
      case "date":
        return typeof value === "string" && validation._isDate(value);
      case "dropdown":
        return (field.options ?? []).some((option) => option.value === value);
    }
  },

  _isDate(value: string): boolean {
    if (!dateOnly.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    );
  },
};
export default validation;
