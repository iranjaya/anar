import "server-only";
import { slugSchema } from "@anar/domain/agencies";
import { okSchema } from "@anar/domain/auth";
import {
  markReadSchema,
  type NotificationPage,
  type PushState,
  pushStateSchema,
  pushSubscribedSchema,
  type SubscribePushInput,
  notificationQuerySchema,
  subscribePushSchema,
  unsubscribePushSchema,
} from "@anar/domain/notifications";
import { apiRequest } from "@/lib/api/client";
import { authEnabled, pushEnabled } from "@/lib/api/mode";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";
import { notificationPageSchema } from "./data/notifications";

export async function listNotifications(
  slug: string,
  cursor?: string,
): Promise<ActionResult<NotificationPage> | null> {
  if (!authEnabled()) return null;
  try {
    const company = requireSlug(slug);
    const query = notificationQuerySchema.safeParse({ cursor });
    if (!query.success)
      throw new AppError(
        "validation",
        "This page of notifications is not valid.",
      );
    const data = await apiRequest(
      {
        path: `/api/companies/${company}/notifications/listNotifications`,
        query: query.data.cursor ? { cursor: query.data.cursor } : {},
      },
      notificationPageSchema,
    );
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function markRead(slug: string, ids: string[]) {
  const company = requireSlug(slug);
  const parsed = markReadSchema.safeParse({ ids });
  if (!parsed.success)
    throw new AppError("validation", "Choose notifications to mark read.");
  return apiRequest(
    {
      path: `/api/companies/${company}/notifications/markRead`,
      method: "POST",
      body: parsed.data,
    },
    okSchema,
  );
}

export async function getPushState(
  slug: string,
): Promise<ActionResult<PushState> | null> {
  if (!pushEnabled()) return null;
  try {
    const data = await apiRequest(
      {
        path: `/api/companies/${requireSlug(slug)}/notifications/getPushState`,
      },
      pushStateSchema,
    );
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function subscribePush(slug: string, input: SubscribePushInput) {
  const company = requireSlug(slug);
  const parsed = subscribePushSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      "validation",
      "This browser gave a subscription we cannot use.",
    );
  return apiRequest(
    {
      path: `/api/companies/${company}/notifications/subscribePush`,
      method: "POST",
      body: parsed.data,
    },
    pushSubscribedSchema,
  );
}

export async function unsubscribePush(slug: string, subscriptionId: string) {
  const company = requireSlug(slug);
  const parsed = unsubscribePushSchema.safeParse({ subscriptionId });
  if (!parsed.success) throw new AppError("validation", "Choose a device.");
  return apiRequest(
    {
      path: `/api/companies/${company}/notifications/unsubscribePush`,
      method: "POST",
      body: parsed.data,
    },
    okSchema,
  );
}

function requireSlug(slug: string) {
  if (!authEnabled())
    throw new AppError("unavailable", "Notifications are not available yet.");
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) throw new AppError("not_found", "Company not found.");
  return parsed.data;
}
