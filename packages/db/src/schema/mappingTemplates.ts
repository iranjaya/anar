import { index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { at, companyColumns, companyPolicies } from "./companyRows.js";
import { users } from "./platform.js";

export type StoredMapping = { header: string; target: string }[];

export const mappingTemplates = pgTable(
  "mapping_templates",
  {
    ...companyColumns(),
    name: text("name").notNull(),
    headerFingerprint: text("header_fingerprint").notNull(),
    headers: jsonb("headers").notNull().$type<string[]>(),
    mapping: jsonb("mapping").notNull().$type<StoredMapping>(),
    formName: text("form_name"),
    campaignName: text("campaign_name"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    lastUsedAt: at("last_used_at"),
  },
  (table) => [
    unique("mapping_templates_company_id_key").on(table.companyId, table.id),
    unique("mapping_templates_fingerprint_key").on(
      table.companyId,
      table.headerFingerprint,
    ),
    index("mapping_templates_form_idx").on(table.companyId, table.formName),
    ...companyPolicies("mapping_templates", table.companyId),
  ],
).enableRLS();
