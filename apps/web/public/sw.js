// Same targets as notificationInputSchema in @anar/domain/notifications.
const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const target = new RegExp(
  `^/[a-z0-9][a-z0-9-]*[a-z0-9](?:/today|/dashboard|/notifications|/imports/${id}|/leads/${id})?$`,
);

function safePath(url) {
  return typeof url === "string" && target.test(url) ? url : "/";
}

function text(value, max) {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : null;
}

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {}
  const title = text(message.title, 160) ?? "Anar";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: text(message.body, 500) ?? "You have a new notification.",
      tag: text(message.tag, 240) ?? undefined,
      icon: "/icons/icon-192.png",
      data: { url: safePath(message.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    safePath(event.notification.data?.url),
    self.location.origin,
  );
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const open = windows.find(
          (client) => new URL(client.url).origin === url.origin,
        );
        if (open)
          return open
            .focus()
            .then(() => open.navigate(url.href))
            .catch(() => self.clients.openWindow(url.href));
        return self.clients.openWindow(url.href);
      }),
  );
});
