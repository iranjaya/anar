import { wireDateSchema } from "@anar/domain/http";
import {
  notificationPageWireSchema,
  notificationWireSchema,
} from "@anar/domain/notifications";

const date = wireDateSchema.transform((value) => new Date(value));

export const notificationPageSchema = notificationPageWireSchema.extend({
  items: notificationWireSchema
    .extend({
      readAt: date.nullable(),
      pushedAt: date.nullable(),
      emailedAt: date.nullable(),
      createdAt: date,
    })
    .array(),
});
