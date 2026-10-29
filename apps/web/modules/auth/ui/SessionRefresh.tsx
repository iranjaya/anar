"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { actionFailure } from "@/lib/errors";
import { refreshSession } from "../browser";

export function SessionRefresh() {
  const router = useRouter();
  const retry = useRef<() => void>(() => {});
  const [message, setMessage] = useState("");
  useEffect(() => {
    let alive = true;
    let pending = false;
    let due = 0;
    const refresh = async (force = false) => {
      if (
        pending ||
        document.visibilityState !== "visible" ||
        (!force && Date.now() < due)
      )
        return;
      pending = true;
      setMessage("");
      due = Date.now() + 60 * 60 * 1000;
      try {
        await refreshSession();
        if (alive) setMessage("");
      } catch (error) {
        if (!alive) return;
        const failure = actionFailure(error);
        if (!failure.ok && failure.error === "unauthorized") {
          router.replace("/login");
          router.refresh();
        } else setMessage("Could not renew your session. Try again.");
      } finally {
        pending = false;
      }
    };
    void refresh();
    retry.current = () => {
      void refresh(true);
    };
    const visible = () => {
      void refresh();
    };
    const timer = setInterval(visible, 60 * 60 * 1000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      retry.current = () => {};
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [router]);
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 text-sm text-overdue"
    >
      <p>{message}</p>
      <button
        type="button"
        onClick={() => {
          retry.current();
        }}
        className="min-h-11 font-semibold underline underline-offset-4"
      >
        Retry session refresh
      </button>
    </div>
  );
}
