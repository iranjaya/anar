import { invites, type PlatformTx, users } from "@anar/db/platform";
import { and, eq, gt, isNull } from "drizzle-orm";

const inviteRepository = {
  async insert(
    tx: PlatformTx,
    input: typeof invites.$inferInsert,
  ): Promise<void> {
    await tx.insert(invites).values(input);
  },

  async readByHash(tx: PlatformTx, tokenHash: string) {
    const [invite] = await tx
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, tokenHash));
    return invite;
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

  async findDeliverable(tx: PlatformTx, id: string, at: Date) {
    const [row] = await tx
      .select({
        id: invites.id,
        agencyId: invites.agencyId,
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
          eq(invites.role, "agency_staff"),
          isNull(invites.companyId),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
          gt(invites.expiresAt, at),
          eq(users.platformRole, "owner"),
          isNull(users.deactivatedAt),
        ),
      );
    return row;
  },
};

export default inviteRepository;
