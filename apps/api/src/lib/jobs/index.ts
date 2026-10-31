import { publish, type QueueTx } from "@anar/db/queue";
import type { JobName, JobPayload } from "@anar/domain/jobs";

export type { HealthProbe, QueueJob, QueueRuntime } from "@anar/db/queue";
export { createHealthProbe } from "@anar/db/queue";

export function enqueue(
  tx: QueueTx,
  job: JobName,
  payload: JobPayload,
  key: string,
): Promise<string> {
  return publish(tx, job, payload, key);
}
