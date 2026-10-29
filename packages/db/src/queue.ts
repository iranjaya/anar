import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss } from "pg-boss";
import { createDb } from "./connection.js";
import type { PlatformTx } from "./platform.js";

export type QueueTx = PlatformTx;

export type QueueJob = {
  id: string;
  data: unknown;
  deliveryKey: string | null;
  signal: AbortSignal;
};
export type QueueRuntime = {
  register(name: string, run: (job: QueueJob) => Promise<void>): Promise<void>;
  heartbeat(workerId: string, startedAt: Date): Promise<void>;
  close(): Promise<void>;
};

export async function createQueueRuntime(
  connectionString: string,
  onError: () => void,
): Promise<QueueRuntime> {
  const handle = createDb(connectionString);
  handle.pool.options.connectionTimeoutMillis = 5000;
  handle.pool.options.statement_timeout = 10000;
  handle.pool.options.query_timeout = 12000;
  const boss = new PgBoss({
    db: fromDrizzle(handle.db, sql),
    migrate: false,
    createSchema: false,
    schedule: false,
    supervise: true,
    reindex: false,
    persistQueueStats: false,
  });
  boss.on("error", onError);
  handle.pool.on("error", onError);
  const close = async () => {
    try {
      await boss.stop({ graceful: true, timeout: 15000 });
    } finally {
      await handle.close();
    }
  };
  try {
    await handle.requireRole("anar_app");
    await boss.start();
  } catch (error) {
    await close();
    throw error;
  }
  return {
    close,
    async register(name, run) {
      await boss.work(
        name,
        { includeMetadata: true, batchSize: 1 },
        async ([job]) => {
          try {
            await run({
              id: job.id,
              data: job.data,
              deliveryKey: job.singletonKey,
              signal: job.signal,
            });
          } catch {
            throw new Error("Job delivery failed");
          }
        },
      );
    },
    async heartbeat(workerId, startedAt) {
      await handle.db.execute(sql`insert into public.worker_heartbeats
        (worker_id, started_at, last_seen_at) values (${workerId}, ${startedAt}, now())
        on conflict (worker_id) do update set last_seen_at = excluded.last_seen_at`);
    },
  };
}

export async function publish(
  tx: QueueTx,
  name: string,
  payload: object,
  key: string,
): Promise<string> {
  const boss = new PgBoss({
    db: fromDrizzle(tx, sql),
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    reindex: false,
  });
  const id = await boss.send(name, payload, { singletonKey: key });
  if (!id) throw new Error("Queue refused the job");
  return id;
}
