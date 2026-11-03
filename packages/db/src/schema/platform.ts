import { sql } from "drizzle-orm";
import {
  check,
  customType,
  foreignKey,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agencies } from "./agencies.js";

const citext = customType<{ data: string }>({ dataType: () => "citext" });

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    status: text("status")
      .notNull()
      .$type<"active" | "suspended" | "closing">(),
    defaultCountry: text("default_country").notNull().$type<"NP">(),
    timezone: text("timezone").notNull().$type<"Asia/Kathmandu">(),
    settings: jsonb("settings")
      .notNull()
      .$type<{ super_admin_can_import: boolean }>()
      .default({ super_admin_can_import: false }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    const scope = sql`${table.agencyId} = NULLIF(current_setting('app.agency_id', true), '')::uuid AND (
    current_setting('app.scope_kind', true) = 'agency' OR (
      current_setting('app.scope_kind', true) = 'company' AND ${table.id} = NULLIF(current_setting('app.company_id', true), '')::uuid
    ))`;
    return [
      check(
        "companies_status_check",
        sql`${table.status} IN ('active', 'suspended', 'closing')`,
      ),
      check("companies_country_check", sql`${table.defaultCountry} = 'NP'`),
      check(
        "companies_timezone_check",
        sql`${table.timezone} = 'Asia/Kathmandu'`,
      ),
      unique("companies_agency_id_idx").on(table.agencyId, table.id),
      index("companies_agency_created_idx").on(
        table.agencyId,
        table.createdAt,
        table.id,
      ),
      pgPolicy("companies_select", {
        for: "select",
        to: "anar_app",
        using: scope,
      }),
      pgPolicy("companies_scheduler_catalog_select", {
        for: "select",
        to: "anar_app",
        using: sql`current_setting('app.scope_kind', true) = 'scheduler_catalog'
          AND current_setting('app.actor_kind', true) = 'scheduler'
          AND ${table.status} = 'active'
          AND EXISTS (SELECT 1 FROM public.agencies AS agency
            WHERE agency.id = ${table.agencyId} AND agency.status = 'active')`,
      }),
      pgPolicy("companies_identity_select", {
        for: "select",
        to: "anar_app",
        using: sql`current_setting('app.scope_kind', true) = 'identity' AND EXISTS (
          SELECT 1 FROM public.company_members AS member
          WHERE member.agency_id = ${table.agencyId} AND member.company_id = ${table.id}
          AND member.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND member.status = 'active'
        )`,
      }),
      pgPolicy("companies_insert", {
        for: "insert",
        to: "anar_app",
        withCheck: scope,
      }),
      pgPolicy("companies_update", {
        for: "update",
        to: "anar_app",
        using: scope,
        withCheck: scope,
      }),
      pgPolicy("companies_delete", {
        for: "delete",
        to: "anar_app",
        using: scope,
      }),
    ];
  },
).enableRLS();

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "restrict" }),
    companyId: uuid("company_id"),
    email: citext("email").notNull(),
    name: text("name").notNull(),
    role: text("role")
      .notNull()
      .$type<"agency_staff" | "super_admin" | "admin">(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "invites_target_check",
      sql`(${table.role} = 'agency_staff' AND ${table.companyId} IS NULL) OR (${table.role} IN ('super_admin', 'admin') AND ${table.companyId} IS NOT NULL)`,
    ),
    uniqueIndex("invites_pending_staff_idx")
      .on(table.agencyId, table.email)
      .where(
        sql`${table.role} = 'agency_staff' AND ${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`,
      ),
    uniqueIndex("invites_pending_company_idx")
      .on(table.companyId, table.email)
      .where(
        sql`${table.companyId} IS NOT NULL AND ${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`,
      ),
    index("invites_agency_created_idx").on(
      table.agencyId,
      table.createdAt,
      table.id,
    ),
    foreignKey({
      columns: [table.agencyId, table.companyId],
      foreignColumns: [companies.agencyId, companies.id],
    }).onDelete("restrict"),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: citext("email").notNull().unique(),
    name: text("name").notNull(),
    platformRole: text("platform_role").$type<"owner">(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "users_platform_role_check",
      sql`${table.platformRole} IS NULL OR ${table.platformRole} = 'owner'`,
    ),
    uniqueIndex("users_single_owner_idx")
      .on(sql`(true)`)
      .where(sql`${table.platformRole} = 'owner'`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull().unique(),
    deviceLabel: text("device_label").notNull(),
    userAgent: text("user_agent").notNull(),
    ip: text("ip").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastOtpAt: timestamp("last_otp_at", { withTimezone: true }).notNull(),
    actingCompanyId: uuid("acting_company_id").references(() => companies.id, {
      onDelete: "restrict",
    }),
    actingReason: text("acting_reason"),
    actingUntil: timestamp("acting_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_expiry_idx").on(table.expiresAt),
    check(
      "sessions_acting_check",
      sql`(
      ${table.actingCompanyId} IS NULL AND ${table.actingReason} IS NULL AND ${table.actingUntil} IS NULL
    ) OR (
      ${table.actingCompanyId} IS NOT NULL AND ${table.actingReason} IS NOT NULL AND ${table.actingUntil} IS NOT NULL
    )`,
    ),
  ],
);

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    codeHash: text("code_hash").notNull(),
    purpose: text("purpose").notNull().$type<"login" | "step_up">(),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "restrict",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: smallint("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ip: text("ip").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("otp_codes_live_user_idx")
      .on(table.userId)
      .where(sql`${table.consumedAt} IS NULL`),
    check("otp_codes_attempts_check", sql`${table.attempts} BETWEEN 0 AND 5`),
    check(
      "otp_codes_purpose_session_check",
      sql`(${table.purpose} = 'login' AND ${table.sessionId} IS NULL) OR (${table.purpose} = 'step_up' AND ${table.sessionId} IS NOT NULL)`,
    ),
  ],
);
