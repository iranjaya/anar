import { invites, type PlatformTx, users } from "@anar/db/platform";
import { and, desc, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";

const inviteRepository = {
  async insert(
    tx: PlatformTx,
    input: typeof invites.$inferInsert,
  ): Promise<boolean> {
    const rows = await tx
      .insert(invites)
      .values(input)
      .onConflictDoNothing()
      .returning({ id: invites.id });
    return rows.length === 1;
  },

  async revokeExpiredCompanyInvite(
    tx: PlatformTx,
    companyId: string,
    email: string,
    at: Date,
  ): Promise<void> {
    await tx
      .update(invites)
      .set({ revokedAt: at })
      .where(
        and(
          eq(invites.companyId, companyId),
          eq(invites.email, email),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
          lte(invites.expiresAt, at),
        ),
      );
  },

  async readByHash(tx: PlatformTx, tokenHash: string) {
    const [invite] = await tx
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, tokenHash));
    return invite;
  },

  async listStaffInvites(
    tx: PlatformTx,
    agencyId: string,
    cursor?: { createdAt: Date; id: string },
  ) {
    return tx
      .select({
        id: invites.id,
        email: invites.email,
        name: invites.name,
        role: sql<"agency_staff">`${invites.role}`,
        expiresAt: invites.expiresAt,
        createdAt: invites.createdAt,
      })
      .from(invites)
      .where(
        and(
          eq(invites.agencyId, agencyId),
          eq(invites.role, "agency_staff"),
          isNull(invites.companyId),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
          cursor
            ? or(
                lt(invites.createdAt, cursor.createdAt),
                and(
                  eq(invites.createdAt, cursor.createdAt),
                  lt(invites.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(invites.createdAt), desc(invites.id))
      .limit(51);
  },

  async lock(tx: PlatformTx, id: string) {
    const [invite] = await tx
      .select()
      .from(invites)
      .where(eq(invites.id, id))
      .for("update");
    return invite;
  },

  async consume(tx: PlatformTx, id: string, at: Date): Promise<void> {
    await tx.update(invites).set({ acceptedAt: at }).where(eq(invites.id, id));
  },

  async lockInitial(tx: PlatformTx, agencyId: string, ownerId: string) {
    const [invite] = await tx
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.agencyId, agencyId),
          eq(invites.createdBy, ownerId),
          eq(invites.role, "agency_staff"),
          isNull(invites.companyId),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
        ),
      )
      .for("update");
    return invite;
  },

  async replaceToken(
    tx: PlatformTx,
    id: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await tx
      .update(invites)
      .set({ tokenHash, expiresAt })
      .where(eq(invites.id, id));
  },

  async findDeliverable(tx: PlatformTx, id: string, at: Date) {
    const [row] = await tx
      .select({
        id: invites.id,
        agencyId: invites.agencyId,
        companyId: invites.companyId,
        role: invites.role,
        issuerRole: users.platformRole,
        createdBy: invites.createdBy,
        email: invites.email,
        expiresAt: invites.expiresAt,
        tokenHash: invites.tokenHash,
      })
      .from(invites)
      .innerJoin(users, eq(users.id, invites.createdBy))
      .where(
        and(
          eq(invites.id, id),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
          gt(invites.expiresAt, at),
          isNull(users.deactivatedAt),
        ),
      );
    return row;
  },
};

export default inviteRepository;
