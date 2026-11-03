import Link from "next/link";
import type { ActionResult } from "@/lib/errors";
import { listNotifications } from "../server";
import type { NotificationPage } from "../types";

function label(result: ActionResult<NotificationPage>) {
  if (!result.ok) return "Notifications unavailable";
  if (result.data.unreadCount === 0) return "Notifications, none unread";
  return `Notifications, ${result.data.unreadCount} unread`;
}

export async function NotificationBell({ slug }: { slug: string }) {
  const result = await listNotifications(slug);
  if (!result) return null;
  return (
    <Link
      href={`/${slug}/notifications`}
      aria-label={label(result)}
      className="inline-flex min-h-11 items-center gap-2 font-semibold text-brand"
    >
      Notifications
      {!result.ok ? (
        <span className="text-sm font-normal text-overdue">unavailable</span>
      ) : (
        result.data.unreadCount > 0 && (
          <span className="rounded-full bg-brand px-2 text-sm text-white tabular-nums">
            {result.data.unreadCount}
          </span>
        )
      )}
    </Link>
  );
}
