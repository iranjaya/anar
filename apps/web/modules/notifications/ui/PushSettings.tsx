"use client";

import type { PushState } from "@anar/domain/notifications";
import { useEffect, useState } from "react";
import { subscribePushAction, unsubscribePushAction } from "../actions";
import {
  applicationServerKey,
  type BrowserPush,
  type DeviceState,
  deviceState,
  toSubscribeInput,
} from "../data/push";

const messages: Record<DeviceState, string> = {
  unsupported: "This browser cannot show notifications.",
  blocked:
    "Notifications are blocked. Allow them for this site in your browser settings.",
  off: "Notifications are off on this device.",
  on: "Notifications are on for this device.",
};

export function PushSettings({
  slug,
  state,
}: {
  slug: string;
  state: PushState;
}) {
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [subscriptionId, setSubscriptionId] = useState(state.subscriptionId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStandalone(isStandalone());
    void readBrowser().then((browser) =>
      setDevice(deviceState(browser, state.enabled)),
    );
  }, [state.enabled]);

  async function enable() {
    setPending(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setDevice(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
      let subscription =
        (await registration.pushManager.getSubscription()) ??
        (await subscribe(registration, state.publicKey));
      let result = await subscribePushAction(
        slug,
        toSubscribeInput(subscription.toJSON()),
      );
      if (!result.ok && result.error === "conflict") {
        await subscription.unsubscribe();
        subscription = await subscribe(registration, state.publicKey);
        result = await subscribePushAction(
          slug,
          toSubscribeInput(subscription.toJSON()),
        );
      }
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSubscriptionId(result.data.subscriptionId);
      setDevice("on");
    } catch {
      setError("Notifications could not be turned on.");
    } finally {
      setPending(false);
    }
  }

  async function disable() {
    if (!subscriptionId) return;
    setPending(true);
    setError(null);
    try {
      const result = await unsubscribePushAction(slug, subscriptionId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSubscriptionId(null);
      setDevice("off");
    } catch {
      setError("Notifications could not be turned off.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="push-heading"
      className="mt-6 rounded-2xl border border-line bg-surface p-5"
    >
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-6">
        <div className="min-w-0">
          <h2 id="push-heading" className="font-semibold">
            This device
          </h2>
          <p role="status" className="mt-1 text-sm text-muted">
            {device ? messages[device] : "Checking this browser…"}
          </p>
        </div>
        {device === "off" && (
          <button
            type="button"
            onClick={enable}
            disabled={pending}
            className="min-h-11 rounded-lg bg-brand px-4 text-sm font-semibold text-surface disabled:opacity-50"
          >
            {pending
              ? "Turning on…"
              : error
                ? "Try again"
                : "Enable notifications"}
          </button>
        )}
        {device === "on" && (
          <button
            type="button"
            onClick={disable}
            disabled={pending}
            className="min-h-11 rounded-lg border border-line-strong px-4 text-sm font-semibold text-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Turning off…" : "Disable this device"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-overdue">
          {error}
        </p>
      )}
      {!standalone && (
        <p className="mt-3 text-sm text-muted">
          To install on iPhone, tap Share, then Add to Home Screen, and open
          Anar from there. On Android, open the browser menu and choose Install
          app.
        </p>
      )}
    </section>
  );
}

async function readBrowser(): Promise<BrowserPush> {
  const supported =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  if (!supported)
    return { supported, permission: "default", subscribed: false };
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return {
    supported,
    permission: Notification.permission,
    subscribed: Boolean(subscription),
  };
}

function subscribe(registration: ServiceWorkerRegistration, publicKey: string) {
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  });
}

function isStandalone() {
  const apple = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    apple.standalone === true
  );
}
