import { defineConfig } from "drizzle-kit";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  throw new Error("MIGRATION_DATABASE_URL is required");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url },
});
