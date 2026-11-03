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

export type QueueHealth = {
  db: "ok" | "down";
  lastSeenAt: Date | null;
  workerHealthy: boolean;
  queue: { waiting: number; active: number; failed: number } | null;
};
export type HealthProbe = {
  read(): Promise<QueueHealth>;
  close(): Promise<void>;
};

export function createHealthProbe(connectionString: string): HealthProbe {
  const handle = createDb(connectionString);
  handle.pool.options.max = 2;
  handle.pool.options.idleTimeoutMillis = 1000;
  handle.pool.options.connectionTimeoutMillis = 2000;
  handle.pool.options.statement_timeout = 2000;
  handle.pool.options.query_timeout = 3000;
  return {
    close: handle.close,
    async read() {
      let beat: { last_seen_at: Date | null; healthy: boolean } | undefined;
      try {
        beat = (
          await handle.db.execute<{
            last_seen_at: Date | null;
            healthy: boolean;
          }>(sql`select max(last_seen_at) as last_seen_at,
            coalesce(max(last_seen_at) > now() - interval '5 minutes', false) as healthy
            from public.worker_heartbeats`)
        ).rows[0];
      } catch {
        return {
          db: "down",
          lastSeenAt: null,
          workerHealthy: false,
          queue: null,
        };
      }
      let queue: QueueHealth["queue"] = null;
      try {
        queue =
          (
            await handle.db.execute<{
              waiting: number;
              active: number;
              failed: number;
            }>(sql`select
              count(*) filter (where state in ('created', 'retry'))::int as waiting,
              count(*) filter (where state = 'active')::int as active,
              count(*) filter (where state = 'failed')::int as failed
              from pgboss.job`)
          ).rows[0] ?? null;
      } catch {}
      return {
        db: "ok",
        lastSeenAt: beat?.last_seen_at ? new Date(beat.last_seen_at) : null,
        workerHealthy: beat?.healthy ?? false,
        queue,
      };
    },
  };
}

export async function publish(
  tx: QueueTx,
  name: string,
  payload: object,
  key: string,
  startAfter?: Date,
): Promise<string> {
  const boss = new PgBoss({
    db: fromDrizzle(tx, sql),
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    reindex: false,
  });
  const id = await boss.send(name, payload, {
    singletonKey: key,
    ...(startAfter ? { startAfter } : {}),
  });
  if (!id) throw new Error("Queue refused the job");
  return id;
}
