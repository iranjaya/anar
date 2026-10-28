"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/errors";

export function DnaBanner({
  companyName,
  onLeaveAction,
}: {
  companyName: string;
  onLeaveAction: () => Promise<ActionResult<{ redirectTo: string }>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <aside
      aria-label="Company access"
      className="border-b border-line bg-brand-soft px-4 py-2"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-brand">DNA · Inside {companyName}</p>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError("");
            startTransition(async () => {
              try {
                const result = await onLeaveAction();
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                router.push(result.data.redirectTo);
                router.refresh();
              } catch {
                setError("Couldn't leave this company. Try again.");
              }
            });
          }}
          className="min-h-11 rounded-lg border border-brand px-4 font-semibold text-brand disabled:opacity-50"
        >
          Leave
        </button>
        {error && (
          <p role="alert" className="w-full text-sm text-overdue">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
