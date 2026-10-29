import { type JobRegistration, registerJobs } from "@anar/api/jobs";
import { createQueueRuntime } from "@anar/db/queue";
import { v7 } from "uuid";

export type WorkerOptions = {
  databaseUrl?: string;
  jobs?: readonly JobRegistration[];
};

export async function startWorker(
  signal: AbortSignal,
  options: WorkerOptions = {},
): Promise<void> {
  if (signal.aborted) return;
  const url = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const failed = new AbortController();
  const stopped = AbortSignal.any([signal, failed.signal]);
  let failure: Error | undefined;
  const fail = () => {
    failure ??= new Error("Worker queue failed");
    failed.abort();
  };
  const runtime = await createQueueRuntime(url, fail);
  const workerId = v7();
  const startedAt = new Date();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let beating = Promise.resolve();
  const scheduleHeartbeat = () => {
    if (stopped.aborted) return;
    timer = setTimeout(() => {
      beating = runtime
        .heartbeat(workerId, startedAt)
        .catch(fail)
        .then(scheduleHeartbeat);
    }, 30000);
  };
  try {
    if (!stopped.aborted) {
      await registerJobs({ queue: runtime, jobs: options.jobs ?? [] });
      if (!stopped.aborted) {
        await runtime.heartbeat(workerId, startedAt);
        scheduleHeartbeat();
        await new Promise<void>((resolve) => {
          if (stopped.aborted) resolve();
          else
            stopped.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    }
  } finally {
    clearTimeout(timer);
    await beating;
    await runtime.close();
  }
  if (failure) throw failure;
}

if (import.meta.main) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await startWorker(controller.signal);
  } catch {
    console.error("Worker stopped after a runtime failure");
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
