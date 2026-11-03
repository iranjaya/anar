import type { SubscribePushInput } from "@anar/domain/notifications";

export type DeviceState = "unsupported" | "blocked" | "on" | "off";
export type BrowserPush = {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
};

export function deviceState(
  browser: BrowserPush,
  savedOn: boolean,
): DeviceState {
  if (!browser.supported) return "unsupported";
  if (browser.permission === "denied") return "blocked";
  if (savedOn && browser.subscribed && browser.permission === "granted")
    return "on";
  return "off";
}

export function toSubscribeInput(
  json: PushSubscriptionJSON,
): SubscribePushInput {
  return {
    endpoint: json.endpoint ?? "",
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    expirationTime: json.expirationTime ?? null,
  };
}

export function applicationServerKey(
  publicKey: string,
): Uint8Array<ArrayBuffer> {
  const base64 = publicKey
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(publicKey.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
