import {
  type NotificationDeliveryJob,
  notificationDeliveryJobSchema,
} from "@anar/domain/jobs";
import type { JobRegistration } from "../../jobs/index.js";
import { type JobControl, withScheduledJob } from "../../lib/jobs/index.js";

export type DeliverPush = (
  job: NotificationDeliveryJob,
  control: JobControl,
) => Promise<void>;

const pushJob = {
  create(deliverPush: DeliverPush): JobRegistration {
    return {
      name: "notify.push",
      run: (job) =>
        withScheduledJob(job, notificationDeliveryJobSchema, deliverPush),
    };
  },
};
export default pushJob;
