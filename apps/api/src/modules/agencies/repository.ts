import { agencies, agencyMembers, type PlatformTx } from "@anar/db/platform";
import { and, desc, eq, lt, or } from "drizzle-orm";

const agencyFields = {
  id: agencies.id,
  name: agencies.name,
  slug: agencies.slug,
  status: agencies.status,
  createdAt: agencies.createdAt,
};
const repository = {
  async create(tx: PlatformTx, input: typeof agencies.$inferInsert) {
    const [agency] = await tx
      .insert(agencies)
      .values(input)
      .onConflictDoNothing({ target: agencies.slug })
      .returning(agencyFields);
    return agency;
  },

  async list(tx: PlatformTx, cursor?: { createdAt: Date; id: string }) {
    return tx
      .select(agencyFields)
      .from(agencies)
      .where(
        cursor
          ? or(
              lt(agencies.createdAt, cursor.createdAt),
              and(
                eq(agencies.createdAt, cursor.createdAt),
                lt(agencies.id, cursor.id),
              ),
            )
          : undefined,
      )
      .orderBy(desc(agencies.createdAt), desc(agencies.id))
      .limit(51);
  },

  async readInitialInviteAgency(
    tx: PlatformTx,
    agencyId: string,
    ownerId: string,
  ) {
    const [agency] = await tx
      .select({ name: agencies.name })
      .from(agencies)
      .where(
        and(
          eq(agencies.id, agencyId),
          eq(agencies.createdBy, ownerId),
          eq(agencies.status, "pending"),
        ),
      );
    return agency;
  },

  async lockAgency(tx: PlatformTx, id: string) {
    const [agency] = await tx
      .select()
      .from(agencies)
      .where(eq(agencies.id, id))
      .for("update");
    return agency;
  },

  async readAgency(tx: PlatformTx, id: string) {
    const [agency] = await tx
      .select(agencyFields)
      .from(agencies)
      .where(eq(agencies.id, id));
    return agency;
  },

  async readOwnStaff(tx: PlatformTx, userId: string) {
    const [staff] = await tx
      .select()
      .from(agencyMembers)
      .where(eq(agencyMembers.userId, userId));
    return staff;
  },

  async lockStaff(tx: PlatformTx, agencyId: string, userId: string) {
    const [staff] = await tx
      .select()
      .from(agencyMembers)
      .where(
        and(
          eq(agencyMembers.agencyId, agencyId),
          eq(agencyMembers.userId, userId),
        ),
      )
      .for("update");
    return staff;
  },

  async insertStaff(tx: PlatformTx, input: typeof agencyMembers.$inferInsert) {
    const [staff] = await tx
      .insert(agencyMembers)
      .values(input)
      .onConflictDoNothing({ target: agencyMembers.userId })
      .returning();
    return staff;
  },

  async activateAgency(
    tx: PlatformTx,
    agencyId: string,
    ownerId: string,
    at: Date,
  ) {
    const rows = await tx
      .update(agencies)
      .set({ status: "active", updatedAt: at })
      .where(
        and(
          eq(agencies.id, agencyId),
          eq(agencies.createdBy, ownerId),
          eq(agencies.status, "pending"),
        ),
      )
      .returning({ id: agencies.id });
    return rows.length === 1;
  },
};

export default repository;
