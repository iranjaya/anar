import { importCommitJobSchema } from "@anar/domain/jobs";
import type { JobRegistration } from "../../jobs/index.js";
import { withScheduledJob } from "../../lib/jobs/index.js";
import job, { type ImportRunnerDeps } from "./job.js";

const commitJob = {
  create(deps: ImportRunnerDeps): JobRegistration {
    return {
      name: "import.commit",
      run: (queued) =>
        withScheduledJob(queued, importCommitJobSchema, (payload, control) =>
          job.runImport(deps, payload, control),
        ),
    };
  },
  key(payload: { companyId: string; batchId: string; runId: string }) {
    return `import:${payload.companyId}:${payload.batchId}:${payload.runId}`;
  },
};
export default commitJob;
