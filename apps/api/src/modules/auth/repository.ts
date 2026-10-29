import { otpCodes, type PlatformTx, sessions, users } from "@anar/db/platform";
import type { AuthUser } from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { and, asc, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";

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

  async lockUsers(tx: PlatformTx, ids: string[]) {
    return tx
      .select()
      .from(users)
      .where(inArray(users.id, ids))
      .orderBy(asc(users.id))
      .for("update");
  },

  async ensureInviteUser(
    tx: PlatformTx,
    input: { id: string; email: string; name: string },
  ) {
    const [created] = await tx
      .insert(users)
      .values(input)
      .onConflictDoNothing({ target: users.email })
      .returning();
    if (created) return created;
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.email, input.email));
    if (!existing) throw new AppError("conflict", "Invite cannot be accepted");
    return existing;
  },

  async readUser(tx: PlatformTx, id: string) {
    const [user] = await tx.select().from(users).where(eq(users.id, id));
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

  async lockActorSessions(
    tx: PlatformTx,
    actor: { userId: string; id: string },
    affectedUserIds: string[],
  ) {
    const current = and(
      eq(sessions.userId, actor.userId),
      eq(sessions.id, actor.id),
    );
    return tx
      .select()
      .from(sessions)
      .where(
        affectedUserIds.length
          ? or(current, inArray(sessions.userId, affectedUserIds))
          : current,
      )
      .orderBy(asc(sessions.id))
      .for("update");
  },

  async listSessions(tx: PlatformTx, userId: string, at: Date) {
    return tx
      .select({
        id: sessions.id,
        deviceLabel: sessions.deviceLabel,
        lastSeenAt: sessions.lastSeenAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, at),
        ),
      )
      .orderBy(desc(sessions.lastSeenAt), desc(sessions.id));
  },

  async revokeSession(
    tx: PlatformTx,
    userId: string,
    id: string,
    at: Date,
  ): Promise<void> {
    await tx
      .update(sessions)
      .set({ revokedAt: at })
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.id, id),
          isNull(sessions.revokedAt),
        ),
      );
  },

  async revokeAllSessions(
    tx: PlatformTx,
    userId: string,
    at: Date,
  ): Promise<void> {
    await tx
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
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
      | "id"
      | "userId"
      | "codeHash"
      | "expiresAt"
      | "ip"
      | "purpose"
      | "sessionId"
    >,
    at: Date,
  ): Promise<void> {
    await tx
      .update(otpCodes)
      .set({ consumedAt: at })
      .where(
        and(eq(otpCodes.userId, input.userId), isNull(otpCodes.consumedAt)),
      );
    await tx.insert(otpCodes).values(input);
  },

  async markFreshOtp(
    tx: PlatformTx,
    userId: string,
    sessionId: string,
    at: Date,
  ): Promise<void> {
    await tx
      .update(sessions)
      .set({ lastOtpAt: at })
      .where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId)));
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
