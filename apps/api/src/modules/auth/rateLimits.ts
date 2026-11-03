import { createHmac, createSecretKey, type KeyObject } from "node:crypto";
import { authRateLimits, type PlatformTx } from "@anar/db/platform";
import { eq } from "drizzle-orm";

export type InviteOperation = "inspect" | "accept";
export type RateLimitResult = { allowed: boolean; retryAfter: number };
export type UploadLimiter = (
  tx: PlatformTx,
  userId: string,
) => Promise<RateLimitResult>;

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
      if (!(await rateLimits._take(tx, limit, pepper, now)).allowed)
        return false;
    }
    return true;
  },

  invite(
    tx: PlatformTx,
    operation: InviteOperation,
    ip: string,
    pepper: KeyObject,
    now: () => Date,
  ): Promise<RateLimitResult> {
    return rateLimits._take(
      tx,
      {
        scope: `invite.${operation}.ip`,
        value: ip,
        max: operation === "inspect" ? 60 : 10,
        windowMs: operation === "inspect" ? 60000 : 3600000,
      },
      pepper,
      now,
    );
  },

  resendInvite(
    tx: PlatformTx,
    inviteId: string,
    pepper: KeyObject,
    now: () => Date,
  ): Promise<RateLimitResult> {
    return rateLimits._take(
      tx,
      { scope: "invite.resend", value: inviteId, max: 3, windowMs: 10 * 60000 },
      pepper,
      now,
    );
  },

  createUploadLimiter(encodedPepper: string, now: () => Date): UploadLimiter {
    const pepper = createSecretKey(Buffer.from(encodedPepper, "base64"));
    return (tx, userId) => rateLimits.uploadImport(tx, userId, pepper, now);
  },

  uploadImport(
    tx: PlatformTx,
    userId: string,
    pepper: KeyObject,
    now: () => Date,
  ): Promise<RateLimitResult> {
    return rateLimits._take(
      tx,
      {
        scope: "imports.upload.user",
        value: userId,
        max: 20,
        windowMs: 3600000,
      },
      pepper,
      now,
    );
  },

  async _take(
    tx: PlatformTx,
    limit: { scope: string; value: string; max: number; windowMs: number },
    pepper: KeyObject,
    now: () => Date,
  ): Promise<RateLimitResult> {
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
    const retryAfter = allowed
      ? 0
      : Math.ceil((hits[0].getTime() + limit.windowMs - at.getTime()) / 1000);
    if (allowed) hits.push(at);
    await tx
      .update(authRateLimits)
      .set({ hits, updatedAt: at })
      .where(eq(authRateLimits.keyHash, keyHash));
    return { allowed, retryAfter };
  },
};

export default rateLimits;
