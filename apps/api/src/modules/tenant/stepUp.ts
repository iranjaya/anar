import { AppError } from "@anar/domain/errors";

const stepUp = {
  requireFreshOtp(
    actor: { session: { lastOtpAt: Date } },
    at: Date = new Date(),
  ): void {
    if (at.getTime() - actor.session.lastOtpAt.getTime() > 15 * 60 * 1000) {
      throw new AppError("step_up_required", "Verify a fresh code to continue");
    }
  },
};

export default stepUp;
