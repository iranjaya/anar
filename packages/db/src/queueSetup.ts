import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss } from "pg-boss";
import type { DbHandle } from "./connection.js";

export async function setupQueue(handle: DbHandle): Promise<void> {
  await handle.requireRole("anar_migrate");
  await handle.withConnection(async (connection) => {
    await connection.execute(sql`select pg_advisory_lock(261029, 12)`);
    const boss = new PgBoss({
      db: fromDrizzle(connection, sql),
      supervise: false,
      schedule: false,
      registerInstance: false,
      reindex: false,
    });
    boss.on("error", () => {
      process.stderr.write("Queue setup failed\n");
    });
    try {
      await boss.start();
      await boss.createQueue("notify.email", {
        policy: "short",
        retryLimit: 3,
        retryDelay: 10,
        retryBackoff: true,
        expireInSeconds: 30,
        retentionSeconds: 600,
        deleteAfterSeconds: 86400,
      });
      // One delivery plus two retries, each allowed 15 minutes to finish.
      await boss.createQueue("import.commit", {
        policy: "short",
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 900,
        retentionSeconds: 86400,
        deleteAfterSeconds: 7 * 86400,
      });
      await boss.createQueue("notify.push", {
        policy: "short",
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 60,
        retentionSeconds: 3600,
        deleteAfterSeconds: 86400,
      });
      await boss.createQueue("notify.summary_email", {
        policy: "short",
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 60,
        retentionSeconds: 86400,
        deleteAfterSeconds: 7 * 86400,
      });
      await boss.createQueue("followups.overdue_scan", {
        policy: "short",
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 900,
        retentionSeconds: 86400,
        deleteAfterSeconds: 7 * 86400,
      });
      await boss.createQueue("reports.summary", {
        policy: "short",
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 900,
        retentionSeconds: 86400,
        deleteAfterSeconds: 7 * 86400,
      });
      await connection.execute(sql`revoke all on schema pgboss from public;
        grant usage on schema pgboss to anar_app;
        revoke all on all tables in schema pgboss from public, anar_app;
        grant select on pgboss.version to anar_app;
        grant update (flow_on, monitor_backoff_on) on pgboss.version to anar_app;
        grant select, update on pgboss.queue to anar_app;
        grant select, insert, update, delete on
          pgboss.job, pgboss.job_common, pgboss.schedule,
          pgboss.subscription, pgboss.warning, pgboss.queue_stats,
          pgboss.job_dependency, pgboss.instance to anar_app;
        revoke all on all functions in schema pgboss from public, anar_app;
        grant execute on function pgboss.job_now() to anar_app`);
    } catch (error) {
      await connection.execute(sql`rollback`);
      throw error;
    } finally {
      try {
        await boss.stop();
      } finally {
        await connection.execute(sql`select pg_advisory_unlock(261029, 12)`);
      }
    }
  });
}
