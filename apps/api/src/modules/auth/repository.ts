import { otpCodes, type PlatformTx, sessions, users } from "@anar/db/platform";
import type { AuthUser } from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { and, eq, gt, isNull } from "drizzle-orm";

const repository = {
  async findOtpUser(tx: PlatformTx, email: string) {
    const [user] = await tx
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deactivatedAt)))
      .for("update");
    return user;
  },

  async lockOtp(tx: PlatformTx, userId: string) {
    const [challenge] = await tx
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.userId, userId), isNull(otpCodes.consumedAt)))
      .for("update");
    return challenge;
  },

  async saveOtpAttempt(
    tx: PlatformTx,
    id: string,
    change: { attempts: number; consumedAt: Date | null },
  ): Promise<void> {
    await tx.update(otpCodes).set(change).where(eq(otpCodes.id, id));
  },

  async insertSession(
    tx: PlatformTx,
    input: typeof sessions.$inferInsert,
  ): Promise<void> {
    await tx.insert(sessions).values(input);
  },

  async readSession(tx: PlatformTx, tokenHash: string) {
    const [row] = await tx
      .select({ user: users, session: sessions })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash));
    return row;
  },

  async lockUser(tx: PlatformTx, id: string) {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, id))
      .for("update");
    return user;
  },

  async lockSession(tx: PlatformTx, userId: string, id: string) {
    const [session] = await tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
      .for("update");
    return session;
  },

  async refreshSession(
    tx: PlatformTx,
    id: string,
    lastSeenAt: Date,
    expiresAt: Date,
  ): Promise<void> {
    await tx
      .update(sessions)
      .set({ lastSeenAt, expiresAt })
      .where(eq(sessions.id, id));
  },

  async replaceOtp(
    tx: PlatformTx,
    input: Pick<
      typeof otpCodes.$inferInsert,
      "id" | "userId" | "codeHash" | "expiresAt" | "ip"
    >,
    at: Date,
  ): Promise<void> {
    await tx
      .update(otpCodes)
      .set({ consumedAt: at })
      .where(
        and(eq(otpCodes.userId, input.userId), isNull(otpCodes.consumedAt)),
      );
    await tx.insert(otpCodes).values({ ...input, purpose: "login" });
  },

  async findDeliverableOtp(tx: PlatformTx, id: string, at: Date) {
    const [challenge] = await tx
      .select({ email: users.email, expiresAt: otpCodes.expiresAt })
      .from(otpCodes)
      .innerJoin(users, eq(users.id, otpCodes.userId))
      .where(
        and(
          eq(otpCodes.id, id),
          isNull(otpCodes.consumedAt),
          gt(otpCodes.expiresAt, at),
          isNull(users.deactivatedAt),
        ),
      );
    return challenge;
  },

  async bootstrapOwner(
    tx: PlatformTx,
    input: { id: string; email: string; name: string },
  ): Promise<{ user: AuthUser; created: boolean }> {
    const [created] = await tx
      .insert(users)
      .values({ ...input, platformRole: "owner" })
      .onConflictDoNothing()
      .returning();
    if (created) return { user: created, created: true };

    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .for("update");
    if (!existing) throw new AppError("conflict", "An owner already exists");
    if (existing.platformRole !== "owner") {
      throw new AppError(
        "conflict",
        "Bootstrap cannot promote an existing user",
      );
    }
    if (existing.deactivatedAt !== null) {
      throw new AppError(
        "conflict",
        "Bootstrap cannot revive an inactive owner",
      );
    }
    return { user: existing, created: false };
  },
};

export default repository;
