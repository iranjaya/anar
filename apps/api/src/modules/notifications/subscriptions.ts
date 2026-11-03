import { createHash } from "node:crypto";
import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type PushState,
  type SubscribePushInput,
  subscribePushSchema,
  type UnsubscribePushInput,
  unsubscribePushSchema,
} from "@anar/domain/notifications";
import audit from "../tenant/audit.js";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import repository from "./repository.js";

export type PushBinding = {
  endpointHash: string;
  userId: string;
  sessionId: string;
};
export type PushDeps = {
  pushEnabled: boolean;
  pushHosts: readonly string[];
  vapidPublicKey: string;
  bindPushEndpoint(
    tx: TenantTx,
    binding: PushBinding,
    at: Date,
  ): Promise<boolean>;
};
type SubscriptionDeps = PushDeps & {
  context: Pick<ReturnType<typeof tenant.create>, "withContext">;
  now(): Date;
};

const subscriptions = {
  create(deps: SubscriptionDeps) {
    return {
      getPushState(actor: Ctx): Promise<PushState> {
        return deps.context.withContext(actor, async (tx, current) => {
          const live = await repository.readLiveSubscription(
            tx,
            {
              companyId: current.companyId,
              userId: current.user.id,
              sessionId: current.session.id,
            },
            deps.now(),
          );
          return {
            enabled: Boolean(live),
            subscriptionId: live?.id ?? null,
            publicKey: deps.vapidPublicKey,
          };
        });
      },
      subscribePush(
        actor: Ctx,
        input: SubscribePushInput,
        meta: { ip: string | null },
      ): Promise<{ subscriptionId: string }> {
        const parsed = subscribePushSchema.safeParse(input);
        if (
          !parsed.success ||
          !deps.pushHosts.includes(new URL(parsed.data.endpoint).hostname)
        )
          throw new AppError("validation", "Push subscription is not valid");
        const { endpoint, keys, expirationTime } = parsed.data;
        const at = deps.now();
        const expiresAt =
          expirationTime === null ? null : new Date(expirationTime);
        if (expiresAt && expiresAt <= at)
          throw new AppError("validation", "Push subscription has expired");
        const endpointHash = createHash("sha256")
          .update(endpoint)
          .digest("hex");
        return deps.context.withContext(actor, async (tx, current) => {
          const bound = await deps.bindPushEndpoint(
            tx,
            {
              endpointHash,
              userId: current.user.id,
              sessionId: current.session.id,
            },
            at,
          );
          if (!bound)
            throw new AppError(
              "conflict",
              "This browser is linked to another sign-in",
            );
          const { id } = await repository.upsertSubscription(tx, {
            companyId: current.companyId,
            userId: current.user.id,
            sessionId: current.session.id,
            endpoint,
            endpointHash,
            p256dh: keys.p256dh,
            auth: keys.auth,
            expiresAt,
            at,
          });
          await audit.audit(
            tx,
            subscriptions._actor(current, meta.ip),
            "notifications.subscribed",
            { type: "push_subscription", id },
            { subscriptionId: id },
          );
          return { subscriptionId: id };
        });
      },
      unsubscribePush(
        actor: Ctx,
        input: UnsubscribePushInput,
        meta: { ip: string | null },
      ): Promise<{ ok: true }> {
        const parsed = unsubscribePushSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError("validation", "Choose a device to turn off");
        const { subscriptionId } = parsed.data;
        return deps.context.withContext(actor, async (tx, current) => {
          const row = await repository.lockOwnSubscription(
            tx,
            { companyId: current.companyId, userId: current.user.id },
            subscriptionId,
          );
          if (!row) throw new AppError("not_found", "Device not found");
          if (row.disabledAt) return { ok: true };
          await repository.disableSubscription(tx, subscriptionId, deps.now());
          await audit.audit(
            tx,
            subscriptions._actor(current, meta.ip),
            "notifications.unsubscribed",
            { type: "push_subscription", id: subscriptionId },
            { subscriptionId },
          );
          return { ok: true };
        });
      },
    };
  },
  _actor(current: Ctx, ip: string | null) {
    return {
      user: current.user,
      role: current.role,
      agencyId: current.agencyId,
      companyId: current.companyId,
      ip,
    };
  },
};
export default subscriptions;
