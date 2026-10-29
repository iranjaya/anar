import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  const reportError = (error: Error) => {
    console.error("Database connection failed", error.message);
  };
  pool.on("error", reportError);
  const db = drizzle(pool);

  return {
    db,
    pool,
    close: () => pool.end(),
    async withConnection<T>(
      fn: (connection: NodePgDatabase) => Promise<T>,
    ): Promise<T> {
      const client = await pool.connect();
      client.on("error", reportError);
      try {
        return await fn(drizzle(client));
      } finally {
        client.release();
        client.off("error", reportError);
      }
    },
    async requireRole(role: "anar_app" | "anar_migrate"): Promise<void> {
      const result = await db.execute<{
        current_role: string;
        login_role: string;
      }>(sql`select current_user as current_role, session_user as login_role`);
      const identity = result.rows[0];
      if (identity?.current_role !== role || identity.login_role !== role) {
        throw new Error(`Database connection requires ${role}`);
      }
    },
  };
}

export type DbHandle = ReturnType<typeof createDb>;
