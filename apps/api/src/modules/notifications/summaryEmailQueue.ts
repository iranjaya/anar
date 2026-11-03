import type { TenantTx } from "@anar/db/tenant";
import type { NotificationDeliveryJob } from "@anar/domain/jobs";
import { enqueue } from "../../lib/jobs/index.js";

export async function queueSummaryEmail(
  tx: TenantTx,
  job: NotificationDeliveryJob,
): Promise<void> {
  await enqueue(
    tx,
    "notify.summary_email",
    job,
    `summary:${job.companyId}:${job.notificationId}`,
  );
}
