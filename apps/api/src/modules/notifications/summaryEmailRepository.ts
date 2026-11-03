import {
  notificationDeliveries,
  notifications,
  readCompanyScope,
  type TenantTx,
} from "@anar/db/tenant";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { v7 } from "uuid";

const summaryEmailRepository = {
  async readCandidate(tx: TenantTx, notificationId: string) {
    const { companyId } = await readCompanyScope(tx);
    const [row] = await tx
      .select({
        id: notifications.id,
        companyId: notifications.companyId,
        userId: notifications.userId,
        type: notifications.type,
        data: notifications.data,
        url: notifications.url,
        createdAt: notifications.createdAt,
        pushedAt: notifications.pushedAt,
        emailedAt: notifications.emailedAt,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.companyId, companyId),
          eq(notifications.id, notificationId),
        ),
      );
    return row as typeof row | undefined;
  },

  async pushState(tx: TenantTx, notificationId: string) {
    const { rows } = await tx.execute<{ open: boolean; sent: boolean }>(sql`
      SELECT
        coalesce(bool_or(state IN ('pending', 'sending')), false) AS open,
        coalesce(bool_or(state = 'sent'), false) AS sent
      FROM notification_deliveries
      WHERE notification_id = ${notificationId} AND channel = 'push'`);
    return rows[0] ?? { open: false, sent: false };
  },

  async saveEnvelope(
    tx: TenantTx,
    input: {
      companyId: string;
      notificationId: string;
      encryptedMessage: string;
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
        encryptedMessage: input.encryptedMessage,
        expiresAt: input.expiresAt,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .onConflictDoUpdate({
        target: [
          notificationDeliveries.companyId,
          notificationDeliveries.notificationId,
          notificationDeliveries.channel,
          notificationDeliveries.targetKey,
        ],
        set: {
          encryptedMessage: sql`coalesce(${notificationDeliveries.encryptedMessage}, excluded.encrypted_message)`,
        },
      });
  },

  async claim(tx: TenantTx, notificationId: string, at: Date) {
    const [row] = await tx
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.notificationId, notificationId),
          eq(notificationDeliveries.channel, "email"),
        ),
      )
      .for("update");
    if (!row || !["pending", "sending"].includes(row.state)) return null;
    if (row.leaseUntil && row.leaseUntil > at) return null;
    if (
      at >= row.expiresAt ||
      (row.firstAttemptAt &&
        at.getTime() - row.firstAttemptAt.getTime() >= 23 * 60 * 60_000) ||
      row.attempts >= 4
    ) {
      await tx
        .update(notificationDeliveries)
        .set({
          state: row.attempts ? "indeterminate" : "skipped",
          leaseUntil: null,
          updatedAt: at,
        })
        .where(eq(notificationDeliveries.id, row.id));
      return null;
    }
    const attempts = row.attempts + 1;
    await tx
      .update(notificationDeliveries)
      .set({
        state: "sending",
        attempts,
        firstAttemptAt: row.firstAttemptAt ?? at,
        leaseUntil: new Date(at.getTime() + 30_000),
        updatedAt: at,
      })
      .where(eq(notificationDeliveries.id, row.id));
    return {
      id: row.id,
      attempts,
      encryptedMessage: row.encryptedMessage,
      stopAt: new Date(
        Math.min(
          row.expiresAt.getTime(),
          (row.firstAttemptAt ?? at).getTime() + 23 * 60 * 60_000,
        ),
      ),
    };
  },

  async finish(
    tx: TenantTx,
    input: {
      id: string;
      notificationId: string;
      attempts: number;
      sent: boolean;
      at: Date;
    },
  ) {
    const [row] = await tx
      .update(notificationDeliveries)
      .set({
        state: input.sent
          ? "sent"
          : input.attempts >= 4
            ? "indeterminate"
            : "pending",
        leaseUntil: null,
        deliveredAt: input.sent ? input.at : null,
        updatedAt: input.at,
      })
      .where(
        and(
          eq(notificationDeliveries.id, input.id),
          eq(notificationDeliveries.state, "sending"),
          eq(notificationDeliveries.attempts, input.attempts),
        ),
      )
      .returning({ id: notificationDeliveries.id });
    if (!row) return false;
    if (input.sent)
      await tx
        .update(notifications)
        .set({ emailedAt: input.at, updatedAt: input.at })
        .where(
          and(
            eq(notifications.id, input.notificationId),
            isNull(notifications.emailedAt),
          ),
        );
    return true;
  },

  async skip(tx: TenantTx, notificationId: string, at: Date) {
    await tx
      .update(notificationDeliveries)
      .set({ state: "skipped", leaseUntil: null, updatedAt: at })
      .where(
        and(
          eq(notificationDeliveries.notificationId, notificationId),
          eq(notificationDeliveries.channel, "email"),
          inArray(notificationDeliveries.state, ["pending", "sending"]),
        ),
      );
  },

  async closeExpired(tx: TenantTx, notificationId: string, at: Date) {
    await tx.execute(sql`UPDATE notification_deliveries
      SET state = CASE WHEN first_attempt_at IS NULL THEN 'skipped'
        ELSE 'indeterminate' END,
        lease_until = NULL, updated_at = ${at}
      WHERE notification_id = ${notificationId} AND channel = 'email'
        AND state IN ('pending', 'sending')`);
  },
};
export default summaryEmailRepository;
