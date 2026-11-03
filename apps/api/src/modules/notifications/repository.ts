import {
  notificationDeliveries,
  notifications,
  pushSubscriptions,
  type TenantTx,
} from "@anar/db/tenant";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { v7 } from "uuid";

type Owner = { companyId: string; userId: string };
type DeliveryChange = Partial<
  Pick<
    typeof notificationDeliveries.$inferInsert,
    "state" | "leaseUntil" | "deliveredAt"
  >
>;
export type ClaimedPush = Awaited<
  ReturnType<typeof repository.claimPush>
>[number];
type NewSubscription = Owner & {
  sessionId: string;
  endpoint: string;
  endpointHash: string;
  p256dh: string;
  auth: string;
  expiresAt: Date | null;
  at: Date;
};

const repository = {
  async insert(tx: TenantTx, input: typeof notifications.$inferInsert) {
    const [row] = await tx
      .insert(notifications)
      .values(input)
      .onConflictDoNothing({
        target: [notifications.userId, notifications.dedupeKey],
      })
      .returning({ id: notifications.id });
    return row;
  },
  async readByKey(tx: TenantTx, userId: string, dedupeKey: string) {
    const [row] = await tx
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.dedupeKey, dedupeKey),
        ),
      );
    return row;
  },
  async list(
    tx: TenantTx,
    owner: Owner,
    cursor: { createdAt: Date; id: string } | null,
    limit: number,
  ) {
    return tx
      .select()
      .from(notifications)
      .where(
        and(
          repository._own(owner),
          cursor
            ? or(
                lt(notifications.createdAt, cursor.createdAt),
                and(
                  eq(notifications.createdAt, cursor.createdAt),
                  lt(notifications.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit);
  },
  async countUnread(tx: TenantTx, owner: Owner): Promise<number> {
    const [row] = await tx
      .select({ count: count() })
      .from(notifications)
      .where(and(repository._own(owner), isNull(notifications.readAt)));
    return row.count;
  },
  async lockOwn(tx: TenantTx, owner: Owner, ids: string[]) {
    return tx
      .select({ id: notifications.id, readAt: notifications.readAt })
      .from(notifications)
      .where(and(repository._own(owner), inArray(notifications.id, ids)))
      .for("update");
  },
  async markRead(tx: TenantTx, ids: string[], at: Date) {
    await tx
      .update(notifications)
      .set({ readAt: at, updatedAt: at })
      .where(and(inArray(notifications.id, ids), isNull(notifications.readAt)));
  },
  async upsertSubscription(
    tx: TenantTx,
    { at, ...row }: NewSubscription,
  ): Promise<{ id: string }> {
    const [saved] = await tx
      .insert(pushSubscriptions)
      .values({ id: v7(), ...row, createdAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: [
          pushSubscriptions.companyId,
          pushSubscriptions.sessionId,
          pushSubscriptions.endpointHash,
        ],
        set: {
          p256dh: row.p256dh,
          auth: row.auth,
          expiresAt: row.expiresAt,
          disabledAt: null,
          updatedAt: at,
        },
      })
      .returning({ id: pushSubscriptions.id });
    return saved;
  },
  async readLiveSubscription(
    tx: TenantTx,
    owner: Owner & { sessionId: string },
    at: Date,
  ) {
    const [row] = await tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.companyId, owner.companyId),
          eq(pushSubscriptions.userId, owner.userId),
          eq(pushSubscriptions.sessionId, owner.sessionId),
          isNull(pushSubscriptions.disabledAt),
          or(
            isNull(pushSubscriptions.expiresAt),
            gt(pushSubscriptions.expiresAt, at),
          ),
        ),
      )
      .orderBy(desc(pushSubscriptions.updatedAt), desc(pushSubscriptions.id))
      .limit(1);
    return row;
  },
  async lockOwnSubscription(tx: TenantTx, owner: Owner, id: string) {
    const [row] = await tx
      .select({ disabledAt: pushSubscriptions.disabledAt })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.id, id),
          eq(pushSubscriptions.companyId, owner.companyId),
          eq(pushSubscriptions.userId, owner.userId),
        ),
      )
      .for("update");
    return row;
  },
  async disableSubscription(tx: TenantTx, id: string, at: Date) {
    await tx
      .update(pushSubscriptions)
      .set({ disabledAt: at, updatedAt: at })
      .where(eq(pushSubscriptions.id, id));
  },
  async readNotification(tx: TenantTx, id: string) {
    const [row] = await tx
      .select({
        id: notifications.id,
        companyId: notifications.companyId,
        userId: notifications.userId,
        type: notifications.type,
        url: notifications.url,
        data: notifications.data,
        createdAt: notifications.createdAt,
        pushedAt: notifications.pushedAt,
      })
      .from(notifications)
      .where(eq(notifications.id, id));
    return row;
  },
  async lockNotification(tx: TenantTx, id: string) {
    await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.id, id))
      .for("update");
  },
  async hasEmailFallback(tx: TenantTx, notificationId: string) {
    const [row] = await tx
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.notificationId, notificationId),
          eq(notificationDeliveries.channel, "email"),
        ),
      )
      .limit(1);
    return Boolean(row);
  },
  async reserveEmailFallback(
    tx: TenantTx,
    input: {
      companyId: string;
      notificationId: string;
      expiresAt: Date;
      at: Date;
    },
  ) {
    await tx
      .insert(notificationDeliveries)
      .values({
        id: v7(),
        companyId: input.companyId,
        notificationId: input.notificationId,
        channel: "email",
        targetKey: "email",
        state: "pending",
        expiresAt: input.expiresAt,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .onConflictDoNothing({
        target: [
          notificationDeliveries.companyId,
          notificationDeliveries.notificationId,
          notificationDeliveries.channel,
          notificationDeliveries.targetKey,
        ],
      });
  },
  async listLiveSubscriptions(
    tx: TenantTx,
    owner: Owner,
    at: Date,
    after: string | null,
  ) {
    return tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.companyId, owner.companyId),
          eq(pushSubscriptions.userId, owner.userId),
          isNull(pushSubscriptions.disabledAt),
          or(
            isNull(pushSubscriptions.expiresAt),
            gt(pushSubscriptions.expiresAt, at),
          ),
          after ? gt(pushSubscriptions.id, after) : undefined,
        ),
      )
      .orderBy(asc(pushSubscriptions.id))
      .limit(100);
  },
  async addPushTargets(
    tx: TenantTx,
    notification: { id: string; companyId: string },
    targets: { subscriptionId: string | null; state: "pending" | "skipped" }[],
    expiresAt: Date,
    at: Date,
  ) {
    await tx
      .insert(notificationDeliveries)
      .values(
        targets.map((target) => ({
          id: v7(),
          companyId: notification.companyId,
          notificationId: notification.id,
          channel: "push" as const,
          targetKey: target.subscriptionId ?? "none",
          subscriptionId: target.subscriptionId,
          state: target.state,
          expiresAt,
          createdAt: at,
          updatedAt: at,
        })),
      )
      .onConflictDoNothing();
  },
  async hasPushTargets(tx: TenantTx, notificationId: string) {
    const [row] = await tx
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.notificationId, notificationId),
          eq(notificationDeliveries.channel, "push"),
        ),
      )
      .limit(1);
    return Boolean(row);
  },
  async claimPush(
    tx: TenantTx,
    notificationId: string,
    tried: string[],
    at: Date,
    leaseUntil: Date,
  ) {
    const rows = await tx
      .select({
        id: notificationDeliveries.id,
        attempts: notificationDeliveries.attempts,
        subscriptionId: pushSubscriptions.id,
        sessionId: pushSubscriptions.sessionId,
        endpoint: pushSubscriptions.endpoint,
        endpointHash: pushSubscriptions.endpointHash,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        disabledAt: pushSubscriptions.disabledAt,
        expiresAt: pushSubscriptions.expiresAt,
      })
      .from(notificationDeliveries)
      .innerJoin(
        pushSubscriptions,
        and(
          eq(pushSubscriptions.companyId, notificationDeliveries.companyId),
          eq(pushSubscriptions.id, notificationDeliveries.subscriptionId),
        ),
      )
      .where(
        and(
          eq(notificationDeliveries.notificationId, notificationId),
          eq(notificationDeliveries.channel, "push"),
          inArray(notificationDeliveries.state, ["pending", "sending"]),
          or(
            isNull(notificationDeliveries.leaseUntil),
            lte(notificationDeliveries.leaseUntil, at),
          ),
          tried.length
            ? notInArray(notificationDeliveries.id, tried)
            : undefined,
        ),
      )
      .orderBy(asc(notificationDeliveries.id))
      .limit(100)
      .for("update", { of: notificationDeliveries, skipLocked: true });
    if (!rows.length) return [];
    await tx
      .update(notificationDeliveries)
      .set({
        state: "sending",
        attempts: sql`${notificationDeliveries.attempts} + 1`,
        leaseUntil,
        firstAttemptAt: sql`coalesce(${notificationDeliveries.firstAttemptAt}, ${at})`,
        updatedAt: at,
      })
      .where(
        inArray(
          notificationDeliveries.id,
          rows.map((row) => row.id),
        ),
      );
    return rows.map((row) => ({ ...row, attempts: row.attempts + 1 }));
  },
  async finishDelivery(
    tx: TenantTx,
    claim: { id: string; attempts: number },
    change: DeliveryChange,
    at: Date,
  ): Promise<boolean> {
    const rows = await tx
      .update(notificationDeliveries)
      .set({ ...change, updatedAt: at })
      .where(
        and(
          eq(notificationDeliveries.id, claim.id),
          eq(notificationDeliveries.state, "sending"),
          eq(notificationDeliveries.attempts, claim.attempts),
        ),
      )
      .returning({ id: notificationDeliveries.id });
    return rows.length === 1;
  },
  async skipOpenPush(tx: TenantTx, notificationId: string, at: Date) {
    await tx
      .update(notificationDeliveries)
      .set({ state: "skipped", leaseUntil: null, updatedAt: at })
      .where(
        and(
          eq(notificationDeliveries.notificationId, notificationId),
          eq(notificationDeliveries.channel, "push"),
          inArray(notificationDeliveries.state, ["pending", "sending"]),
        ),
      );
  },
  async hasOpenPush(tx: TenantTx, notificationId: string) {
    const [row] = await tx
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.notificationId, notificationId),
          eq(notificationDeliveries.channel, "push"),
          inArray(notificationDeliveries.state, ["pending", "sending"]),
        ),
      )
      .limit(1);
    return Boolean(row);
  },
  async nextOpenPushAt(tx: TenantTx, notificationId: string, at: Date) {
    const { rows } = await tx.execute<{ next_at: Date | null }>(sql`
      SELECT min(coalesce(lease_until, ${at})) AS next_at
      FROM notification_deliveries
      WHERE notification_id = ${notificationId} AND channel = 'push'
        AND state IN ('pending', 'sending')`);
    return rows[0]?.next_at ? new Date(rows[0].next_at) : null;
  },
  async markPushed(tx: TenantTx, id: string, at: Date) {
    await tx
      .update(notifications)
      .set({ pushedAt: at, updatedAt: at })
      .where(and(eq(notifications.id, id), isNull(notifications.pushedAt)));
  },
  _own(owner: Owner) {
    return and(
      eq(notifications.companyId, owner.companyId),
      eq(notifications.userId, owner.userId),
    );
  },
};
export default repository;
