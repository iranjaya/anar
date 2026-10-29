import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agencies } from "./agencies.js";

const citext = customType<{ data: string }>({ dataType: () => "citext" });

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
    role: text("role").notNull().$type<"agency_staff">(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "invites_target_check",
      sql`${table.role} = 'agency_staff' AND ${table.companyId} IS NULL`,
    ),
    uniqueIndex("invites_pending_staff_idx")
      .on(table.agencyId, table.email)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
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
    actingCompanyId: uuid("acting_company_id"),
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
