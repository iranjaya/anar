// A worker process for the import queue that either never finishes a job or finishes at once.
import { createQueueRuntime } from "@anar/db/queue";

const runtime = await createQueueRuntime(process.env.DATABASE_URL, () => {});
await runtime.register("import.commit", () =>
  process.env.IMPORT_JOB === "finish"
    ? Promise.resolve()
    : new Promise(() => {}),
);
process.stdout.write("ready\n");
