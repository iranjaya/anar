import type { JobRegistration } from "@anar/api/jobs";
import { publish } from "@anar/db/queue";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { v7 } from "uuid";
import { startMailpit } from "../../../../test/support/mailpit.js";
import { startPostgres } from "../../../../test/support/postgres.js";
import { createTestRuntimeConfig } from "../../../../test/support/runtime-config.js";
import { startWorker } from "../../src/main.js";

export async function startFixture() {
  const postgres = await startPostgres();
  let mailpit: Awaited<ReturnType<typeof startMailpit>> | undefined;
  const pools: Pool[] = [];
  let queue: PgBoss | undefined;
  const workers: { controller: AbortController; done: Promise<unknown> }[] = [];
  const stopWorkers = async () => {
    for (const worker of workers) worker.controller.abort();
    await Promise.all(workers.splice(0).map((worker) => worker.done));
  };
  const close = async () => {
    try {
      await stopWorkers();
      await queue?.stop({ timeout: 2000 });
      await Promise.all(pools.map((pool) => pool.end()));
    } finally {
      await Promise.all([mailpit?.stop(), postgres.stop()]);
    }
  };
  try {
    await postgres.bootstrap();
    await postgres.migrate();
    mailpit = await startMailpit();
    const env = {
      ...createTestRuntimeConfig(postgres.appUrl),
      EMAIL_TRANSPORT: "mailpit",
      MAILPIT_URL: mailpit.url,
      EMAIL_FROM: "sender@example.test",
      RESEND_API_KEY: "",
    };
    const pool = (connectionString: string) => {
      const handle = new Pool({
        connectionString,
        application_name: "s12b-observer",
      });
      pools.push(handle);
      return handle;
    };
    const runtime = pool(postgres.appUrl);
    const owner = pool(postgres.migrationUrl);
    const admin = pool(postgres.adminUrl);
    const db = drizzle(runtime);
    const boss = new PgBoss({
      connectionString: postgres.migrationUrl,
      application_name: "s12b-observer",
      migrate: false,
      createSchema: false,
      supervise: false,
      schedule: false,
      reindex: false,
      persistQueueStats: false,
      registerInstance: false,
    });
    queue = boss;
    await boss.start();
    return {
      postgres,
      mailpit,
      env,
      runtime,
      owner,
      admin,
      db,
      queue: boss,
      close,
      stopWorkers,
      async createQueue() {
        const name = `s12b-${v7()}`;
        await boss.createQueue(name, {
          retryLimit: 3,
          retryDelay: 1,
          expireInSeconds: 30,
        });
        return name;
      },
      async publish(name: string, payload: object, key = v7()) {
        return db.transaction((tx) => publish(tx, name, payload, key));
      },
      start(
        jobs: readonly JobRegistration[] = [],
        databaseUrl = postgres.appUrl,
      ) {
        const controller = new AbortController();
        const done = startWorker(controller.signal, {
          databaseUrl,
          jobs,
        }).catch((error: unknown) => error);
        const worker = { controller, done };
        workers.push(worker);
        return worker;
      },
      async activeConnections() {
        const result =
          await admin.query(`select count(*)::int as count from pg_stat_activity
          where datname = current_database() and backend_type = 'client backend'
            and application_name <> 's12b-observer'`);
        return result.rows[0].count as number;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export type WorkerFixture = Awaited<ReturnType<typeof startFixture>>;
