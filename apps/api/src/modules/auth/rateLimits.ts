import { createHmac, type KeyObject } from "node:crypto";
import { authRateLimits, type PlatformTx } from "@anar/db/platform";
import { eq } from "drizzle-orm";

const rateLimits = {
  async requestOtp(
    tx: PlatformTx,
    input: { email: string; ip: string },
    pepper: KeyObject,
    now: () => Date,
  ): Promise<boolean> {
    for (const limit of [
      { scope: "otp.ip", value: input.ip, max: 20, windowMs: 60 * 60 * 1000 },
      {
        scope: "otp.email",
        value: input.email,
        max: 3,
        windowMs: 10 * 60 * 1000,
      },
    ]) {
      const keyHash = createHmac("sha256", pepper)
        .update(JSON.stringify(["rate", limit.scope, limit.value]))
        .digest("hex");
      await tx
        .insert(authRateLimits)
        .values({ keyHash, scope: limit.scope })
        .onConflictDoNothing();
      const [row] = await tx
        .select({ hits: authRateLimits.hits })
        .from(authRateLimits)
        .where(eq(authRateLimits.keyHash, keyHash))
        .for("update");
      const at = now();
      const hits = row.hits.filter(
        (hit) => hit.getTime() > at.getTime() - limit.windowMs,
      );
      const allowed = hits.length < limit.max;
      if (allowed) hits.push(at);
      await tx
        .update(authRateLimits)
        .set({ hits, updatedAt: at })
        .where(eq(authRateLimits.keyHash, keyHash));
      if (!allowed) return false;
    }
    return true;
  },
};

export default rateLimits;
