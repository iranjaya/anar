import { sql } from "drizzle-orm";
import {
  check,
  customType,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({ dataType: () => "citext" });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: citext("email").notNull().unique(),
    name: text("name").notNull(),
    platformRole: text("platform_role").$type<"dna">(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "users_platform_role_check",
      sql`${table.platformRole} IS NULL OR ${table.platformRole} = 'dna'`,
    ),
  ],
);
