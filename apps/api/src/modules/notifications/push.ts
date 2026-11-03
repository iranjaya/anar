import type { NotificationData } from "@anar/domain/notifications";
import webpush from "web-push";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type PushMessage = {
  notificationId: string;
  title: string;
  body: string;
  url: string;
  tag: string;
};
export type PushResponse = { status: number; retryAfter: string | null };
export type SendPush = (
  target: PushTarget,
  message: PushMessage,
  ttlSeconds: number,
  signal: AbortSignal,
) => Promise<PushResponse>;
export type VapidKeys = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

// Lock screens are seen by anyone near the phone, so the text never names a lead.
const titles: Record<NotificationData["type"], string> = {
  import_complete: "Import finished",
  assigned: "New leads for you",
  lost_suggested: "A lead may be lost",
  overdue: "A follow-up is overdue",
  daily: "Today's summary",
  weekly: "This week's summary",
};

const push = {
  message(notification: {
    id: string;
    type: NotificationData["type"];
    url: string;
  }): PushMessage {
    return {
      notificationId: notification.id,
      title: titles[notification.type],
      body: "Open Anar to see it.",
      url: notification.url,
      tag: notification.id,
    };
  },
  createSender(vapid: VapidKeys): SendPush {
    return async (target, message, ttlSeconds, signal) => {
      const request = webpush.generateRequestDetails(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        JSON.stringify(message),
        { vapidDetails: vapid, TTL: ttlSeconds, contentEncoding: "aes128gcm" },
      );
      const headers = Object.entries(request.headers)
        .filter(([name]) => name.toLowerCase() !== "content-length")
        .map(([name, value]): [string, string] => [name, String(value)]);
      const response = await fetch(request.endpoint, {
        method: request.method,
        headers,
        body: new Uint8Array(request.body),
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      await response.body?.cancel();
      return {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
      };
    };
  },
};
export default push;
