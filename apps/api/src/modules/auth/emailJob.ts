import { createPlatformDb, type PlatformDb } from "@anar/db/platform";
import { otpEmailJobSchema } from "@anar/domain/auth";
import type { createMailCodec } from "../../lib/email/crypto.js";
import type { createEmailSender } from "../../lib/email/index.js";
import type { QueueJob } from "../../lib/jobs/index.js";
import repository from "./repository.js";

export type OtpEmailDeps = {
  db: PlatformDb;
  mailCodec: Pick<ReturnType<typeof createMailCodec>, "decryptMessage">;
  sendEmail: ReturnType<typeof createEmailSender>["sendEmail"];
  now(): Date;
};

const emailJob = {
  create(deps: OtpEmailDeps) {
    return {
      name: "notify.email",
      async run(job: QueueJob): Promise<void> {
        const parsed = otpEmailJobSchema.safeParse(job.data);
        if (!parsed.success) throw new Error("Invalid OTP email job");
        const payload = parsed.data;
        const key = `otp:${payload.referenceId}`;
        if (job.deliveryKey !== key)
          throw new Error("Invalid OTP delivery key");
        const expiresAt = new Date(payload.expiresAt);
        if (deps.now().getTime() >= expiresAt.getTime()) return;
        const challenge = await deps.db.transaction((tx) =>
          repository.findDeliverableOtp(tx, payload.referenceId, deps.now()),
        );
        if (!challenge || challenge.expiresAt.getTime() !== expiresAt.getTime())
          return;
        const message = deps.mailCodec.decryptMessage(
          payload.encryptedMessage,
          key,
        );
        if (message.to !== challenge.email)
          throw new Error("Invalid OTP recipient");
        const remaining = expiresAt.getTime() - deps.now().getTime();
        if (remaining <= 0) return;
        await deps.sendEmail({
          ...message,
          deliveryKey: key,
          signal: AbortSignal.any([job.signal, AbortSignal.timeout(remaining)]),
        });
      },
    };
  },

  async start(
    options: Omit<OtpEmailDeps, "db"> & { connectionString: string },
  ) {
    const db = await createPlatformDb(options.connectionString);
    return { job: emailJob.create({ ...options, db }), close: db.close };
  },
};

export default emailJob;
