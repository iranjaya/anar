import { z } from "zod";
import { wireDateSchema } from "./http.js";

const count = z.number().int().nonnegative();
const localDate = z.iso.date();
const rank = z.strictObject({
  name: z.string().min(1).max(160),
  calls: count,
  tied: z.boolean(),
});

export const notificationDataSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("import_complete"),
    batchId: z.uuid(),
    imported: count,
    duplicateDb: count,
  }),
  z.strictObject({
    type: z.literal("assigned"),
    assignmentId: z.uuid(),
    count,
  }),
  z.strictObject({
    type: z.literal("lost_suggested"),
    leadId: z.uuid(),
    failedAttempts: count,
  }),
  z.strictObject({ type: z.literal("overdue"), leadId: z.uuid(), localDate }),
  z.strictObject({
    type: z.literal("daily"),
    localDate,
    overdue: count,
    dueToday: count,
    newLeads: count,
  }),
  z.strictObject({
    type: z.literal("weekly"),
    weekStart: localDate,
    leads: count,
    calls: count,
    siteVisits: count,
    bookings: count,
    overdue: count,
    staffCalls: count,
    top: rank.nullable(),
    bottom: rank.nullable(),
  }),
]);
export type NotificationData = z.infer<typeof notificationDataSchema>;

const keyPrefix: Record<NotificationData["type"], string> = {
  import_complete: "import",
  assigned: "assign",
  lost_suggested: "lost",
  overdue: "overdue",
  daily: "daily",
  weekly: "weekly",
};
const slug = "[a-z0-9][a-z0-9-]*[a-z0-9]";
const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const targetUrl = new RegExp(
  `^/(${slug})(?:/today|/dashboard|/notifications|/imports/${id}|/leads/${id})?$`,
);

export const notificationInputSchema = z
  .strictObject({
    companyId: z.uuid(),
    userId: z.uuid(),
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(500),
    url: z.string().regex(targetUrl),
    dedupeKey: z.string().min(1).max(240),
    data: notificationDataSchema,
  })
  .refine(
    (input) =>
      input.dedupeKey.startsWith(
        `${keyPrefix[input.data.type]}:${input.companyId}:`,
      ),
    { message: "Key must name its type and company", path: ["dedupeKey"] },
  );
export type NotificationInput = z.infer<typeof notificationInputSchema>;

export function notificationSlug(url: string): string {
  const match = targetUrl.exec(url);
  if (!match) throw new Error("Not a notification target");
  return match[1];
}

export type Notification = NotificationInput & {
  id: string;
  type: NotificationData["type"];
  readAt: Date | null;
  pushedAt: Date | null;
  emailedAt: Date | null;
  createdAt: Date;
};
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
export type NotificationPage = {
  items: Notification[];
  nextCursor: string | null;
  unreadCount: number;
};

export const notificationQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(200).optional(),
});
export const markReadSchema = z.strictObject({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "IDs must be unique"),
});
export type MarkReadInput = z.infer<typeof markReadSchema>;

export const notificationWireSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  userId: z.uuid(),
  type: z.enum([
    "import_complete",
    "assigned",
    "lost_suggested",
    "overdue",
    "daily",
    "weekly",
  ]),
  title: z.string(),
  body: z.string(),
  url: z.string().regex(targetUrl),
  dedupeKey: z.string(),
  data: notificationDataSchema,
  readAt: wireDateSchema.nullable(),
  pushedAt: wireDateSchema.nullable(),
  emailedAt: wireDateSchema.nullable(),
  createdAt: wireDateSchema,
});
export const notificationPageWireSchema = z.strictObject({
  items: z.array(notificationWireSchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int().nonnegative(),
});

// Base64url without padding: p256dh is a 65-byte uncompressed P-256 point, auth is 16 bytes.
const p256dh = /^B[A-Za-z0-9_-]{85}[AEIMQUYcgkosw048]$/;
const authSecret = /^[A-Za-z0-9_-]{21}[AQgw]$/;
// https, a plain host with no user, password or port, and no fragment.
const pushEndpoint = /^https:\/\/[a-z0-9.-]+\/[^\s#]*$/i;
const pushEndpointSchema = z.string().max(1024).regex(pushEndpoint);

export const subscribePushSchema = z.strictObject({
  endpoint: pushEndpointSchema,
  keys: z.strictObject({
    p256dh: z.string().regex(p256dh),
    auth: z.string().regex(authSecret),
  }),
  expirationTime: z.number().int().positive().nullable(),
});
export type SubscribePushInput = z.infer<typeof subscribePushSchema>;
export const unsubscribePushSchema = z.strictObject({
  subscriptionId: z.uuid(),
});
export type UnsubscribePushInput = z.infer<typeof unsubscribePushSchema>;

export const pushStateSchema = z.strictObject({
  enabled: z.boolean(),
  subscriptionId: z.uuid().nullable(),
  publicKey: z.string(),
});
export type PushState = z.infer<typeof pushStateSchema>;
export const pushSubscribedSchema = z.strictObject({
  subscriptionId: z.uuid(),
});
