import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { migrate as applyMigrations } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./connection.js";
import { setupQueue } from "./queueSetup.js";

export async function migrate(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error("MIGRATION_DATABASE_URL is required");
  }
  const handle = createDb(url);
  try {
    await handle.requireRole("anar_migrate");
    const migrationsFolder = fileURLToPath(
      new URL("../migrations/", import.meta.url),
    );
    const files = await readdir(migrationsFolder).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    if (files.length > 0) {
      await handle.withConnection((connection) =>
        applyMigrations(connection, { migrationsFolder }),
      );
    }
    await setupQueue(handle);
  } finally {
    await handle.close();
  }
}

if (import.meta.main) {
  await migrate().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
