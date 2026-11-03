import {
  type PlatformTx,
  pushEndpointBindings,
  sessions,
  users,
} from "@anar/db/platform";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

export type PushBinding = {
  endpointHash: string;
  userId: string;
  sessionId: string;
};

export type LivePushBinding = {
  userId: string;
  sessionId: string;
  actingCompanyId: string | null;
  actingUntil: Date | null;
};

// One browser endpoint belongs to one live session, across all companies.
const pushBindings = {
  async bindPushEndpoint(
    tx: PlatformTx,
    binding: PushBinding,
    at: Date,
  ): Promise<boolean> {
    const rows = await tx
      .insert(pushEndpointBindings)
      .values({ ...binding, boundAt: at, releasedAt: null })
      .onConflictDoUpdate({
        target: pushEndpointBindings.endpointHash,
        set: {
          userId: binding.userId,
          sessionId: binding.sessionId,
          boundAt: at,
          releasedAt: null,
        },
        setWhere: sql`${pushEndpointBindings.sessionId} = ${binding.sessionId}
          OR ${pushEndpointBindings.releasedAt} IS NOT NULL
          OR NOT ${pushBindings._live(pushEndpointBindings.sessionId, at)}`,
      })
      .returning({ endpointHash: pushEndpointBindings.endpointHash });
    return rows.length === 1;
  },

  async readLivePushBinding(
    tx: PlatformTx,
    endpointHash: string,
  ): Promise<LivePushBinding | undefined> {
    const [row] = await tx
      .select({
        userId: pushEndpointBindings.userId,
        sessionId: pushEndpointBindings.sessionId,
        actingCompanyId: sessions.actingCompanyId,
        actingUntil: sessions.actingUntil,
      })
      .from(pushEndpointBindings)
      .innerJoin(sessions, eq(sessions.id, pushEndpointBindings.sessionId))
      .innerJoin(users, eq(users.id, pushEndpointBindings.userId))
      .where(
        and(
          eq(pushEndpointBindings.endpointHash, endpointHash),
          isNull(pushEndpointBindings.releasedAt),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
          isNull(users.deactivatedAt),
        ),
      );
    return row;
  },

  async release(
    tx: PlatformTx,
    owner: { userId: string; sessionId?: string },
    at: Date,
  ): Promise<void> {
    await tx
      .update(pushEndpointBindings)
      .set({ releasedAt: at })
      .where(
        and(
          eq(pushEndpointBindings.userId, owner.userId),
          owner.sessionId
            ? eq(pushEndpointBindings.sessionId, owner.sessionId)
            : undefined,
          isNull(pushEndpointBindings.releasedAt),
        ),
      );
  },

  _live(sessionId: typeof pushEndpointBindings.sessionId, at: Date) {
    return sql`EXISTS (
      SELECT 1 FROM ${sessions} JOIN ${users} ON ${users.id} = ${sessions.userId}
      WHERE ${sessions.id} = ${sessionId}
      AND ${sessions.revokedAt} IS NULL
      AND ${sessions.expiresAt} > ${at}
      AND ${users.deactivatedAt} IS NULL
    )`;
  },
};
export default pushBindings;
