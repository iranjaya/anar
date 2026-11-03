import { publish, type QueueJob, type QueueTx } from "@anar/db/queue";
import type { JobName, JobPayloads } from "@anar/domain/jobs";
import { sql } from "drizzle-orm";

export type { HealthProbe, QueueJob, QueueRuntime } from "@anar/db/queue";
export { createHealthProbe } from "@anar/db/queue";

export type JobControl = { signal: AbortSignal };
type PayloadSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

export function enqueue<N extends JobName>(
  tx: QueueTx,
  job: N,
  payload: JobPayloads[N],
  key: string,
  startAfter?: Date,
): Promise<string> {
  return publish(tx, job, payload, key, startAfter);
}

export async function withScheduledJob<T>(
  job: QueueJob,
  schema: PayloadSchema<T>,
  run: (payload: T, control: JobControl) => Promise<void>,
): Promise<void> {
  const parsed = schema.safeParse(job.data);
  if (!parsed.success) throw new Error("Job payload is not valid");
  job.signal.throwIfAborted();
  await run(parsed.data, { signal: job.signal });
}

export type ImportJobState = {
  state: "queued" | "active" | "retrying" | "failed" | "completed" | "missing";
  attempts: number;
};
const queueStates: Record<string, ImportJobState["state"]> = {
  created: "queued",
  retry: "retrying",
  active: "active",
  completed: "completed",
  failed: "failed",
  cancelled: "failed",
};

// pg-boss adds one to retry_count only when it re-claims a started job.
export async function readImportJobState(
  tx: QueueTx,
  jobId: string,
): Promise<ImportJobState> {
  const { rows } = await tx.execute<{ state: string; attempts: number }>(
    sql`select state::text as state,
      retry_count + (started_on is not null)::int as attempts
      from pgboss.job where id = ${jobId} and name = 'import.commit'`,
  );
  const [row] = rows;
  if (!row) return { state: "missing", attempts: 0 };
  return { state: queueStates[row.state], attempts: row.attempts };
}
