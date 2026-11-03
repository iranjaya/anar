import Link from "next/link";
import { notFound } from "next/navigation";
import { ReadError } from "@/components/ReadError";
import { formatClock, formatDay } from "@/lib/dates";
import { getCompanyContext } from "@/modules/tenant/server";
import { getPushState, listNotifications } from "../server";
import type { NotificationPage } from "../types";
import { MarkRead } from "./MarkRead";
import { PushSettings } from "./PushSettings";

export async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const { slug } = await params;
  const { cursor } = await searchParams;
  const context = await getCompanyContext(slug);
  if (!context?.ok) notFound();
  const href = `/${slug}/notifications`;
  const [page, push] = await Promise.all([
    listNotifications(slug, typeof cursor === "string" ? cursor : undefined),
    getPushState(slug),
  ]);
  return (
    <section className="min-w-0">
      <h1 className="font-display text-3xl font-bold">Notifications</h1>
      <p className="mt-2 text-muted wrap-break-word">
        {context.data.company.name}
      </p>
      {push?.ok && <PushSettings slug={slug} state={push.data} />}
      {push && !push.ok && (
        <p role="alert" className="mt-6 text-sm text-overdue">
          Device notifications are unavailable.
        </p>
      )}
      {!page?.ok ? (
        <div className="mt-6">
          <ReadError
            message={page?.message ?? "Notifications could not be loaded."}
            href={href}
          />
        </div>
      ) : (
        <NotificationList
          slug={slug}
          href={href}
          page={page.data}
          timezone={context.data.company.timezone}
        />
      )}
    </section>
  );
}

function NotificationList({
  slug,
  href,
  page,
  timezone,
}: {
  slug: string;
  href: string;
  page: NotificationPage;
  timezone: string;
}) {
  if (page.items.length === 0)
    return (
      <p className="mt-6 rounded-2xl border border-line bg-surface p-6 text-muted">
        No notifications yet.
      </p>
    );
  return (
    <>
      <p className="mt-6 text-sm text-muted">
        {page.unreadCount === 1 ? "1 unread" : `${page.unreadCount} unread`}
      </p>
      <ul className="mt-3 space-y-3">
        {page.items.map((item) => (
          <li
            key={item.id}
            className="grid min-w-0 gap-3 rounded-2xl border border-line bg-surface p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-6"
          >
            <div className="min-w-0">
              <p className="font-semibold wrap-break-word">
                {item.readAt === null && (
                  <span className="mr-2 rounded-full bg-brand px-2 text-xs text-white">
                    Unread
                  </span>
                )}
                {item.title}
              </p>
              <p className="mt-1 text-sm wrap-break-word">{item.body}</p>
              <p className="mt-1 text-sm text-muted">
                <time dateTime={item.createdAt.toISOString()}>
                  {formatDay(item.createdAt, timezone)},{" "}
                  {formatClock(item.createdAt, timezone)}
                </time>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {item.readAt === null && <MarkRead slug={slug} id={item.id} />}
              <Link
                href={item.url}
                className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
              >
                Open
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {page.nextCursor && (
        <Link
          href={`${href}?cursor=${encodeURIComponent(page.nextCursor)}`}
          className="mt-4 inline-flex min-h-11 items-center font-semibold text-brand"
        >
          Older notifications
        </Link>
      )}
    </>
  );
}
