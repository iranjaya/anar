import { createECDH, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";

export type FakePush = {
  permission: "granted" | "denied";
  supported: boolean;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function fakePush(change: Partial<FakePush> = {}): FakePush {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    permission: "granted",
    supported: true,
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`,
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
    ...change,
  };
}

// The real service worker registers; only the push service and the permission prompt are faked.
export async function withFakePush(page: Page, push: FakePush) {
  await page.addInitScript((push) => {
    if (!push.supported) {
      Reflect.deleteProperty(window, "PushManager");
      return;
    }
    let permission: NotificationPermission = "default";
    Object.defineProperty(Notification, "permission", {
      get: () => permission,
    });
    Notification.requestPermission = async () => {
      permission = push.permission;
      return permission;
    };
    const key = "fake-push-subscribed";
    const subscription = {
      endpoint: push.endpoint,
      toJSON: () => ({
        endpoint: push.endpoint,
        expirationTime: null,
        keys: { p256dh: push.p256dh, auth: push.auth },
      }),
      unsubscribe: async () => {
        localStorage.removeItem(key);
        return true;
      },
    };
    PushManager.prototype.getSubscription = async () =>
      (localStorage.getItem(key)
        ? subscription
        : null) as unknown as PushSubscription;
    PushManager.prototype.subscribe = async () => {
      localStorage.setItem(key, "1");
      return subscription as unknown as PushSubscription;
    };
    if (localStorage.getItem(key)) permission = "granted";
  }, push);
}
