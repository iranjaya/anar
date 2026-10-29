"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/errors";
import {
  resetDemoAction,
  setDemoFailureAction,
  switchDemoUserAction,
} from "../actions";
import type { DemoUser } from "../types";

const demoRoles = [
  { role: "dna", label: "DNA" },
  { role: "super_admin", label: "Super Admin" },
  { role: "admin", label: "Admin" },
] as const;

export function DemoBar({
  users,
  userId,
  failure,
  message,
}: {
  users: DemoUser[];
  userId: string;
  failure: boolean;
  message: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [failureOn, setFailureOn] = useState(failure);
  useEffect(() => setFailureOn(failure), [failure]);

  function run<T>(
    operation: () => Promise<ActionResult<T>>,
    onSuccess: (data: T) => void,
  ) {
    setError("");
    startTransition(async () => {
      try {
        const result = await operation();
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onSuccess(result.data);
      } catch {
        setError("Couldn't update the demo. Try again.");
      }
    });
  }

  return (
    <aside
      aria-label="Demo controls"
      className="border-b border-line bg-brand-soft px-4 py-2"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-display font-bold text-brand">Demo</span>
        <label className="flex min-h-11 min-w-0 items-center gap-2 text-sm">
          Demo user
          <select
            value={userId}
            disabled={pending}
            onChange={(event) => {
              const userId = event.currentTarget.value;
              run(
                () => switchDemoUserAction({ userId }),
                (data) => {
                  router.push(data.redirectTo);
                  router.refresh();
                },
              );
            }}
            className="min-h-11 min-w-0 max-w-48 rounded-lg border border-line-strong bg-surface px-2 text-base"
          >
            <option value="" disabled>
              Choose a user
            </option>
            {demoRoles.map(({ role, label }) => (
              <optgroup key={role} label={label}>
                {users
                  .filter((user) => user.role === role)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {label} · {user.name}
                      {user.companyName && `, ${user.companyName}`}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(resetDemoAction, () => {
              setFailureOn(false);
              router.push("/");
              router.refresh();
            })
          }
          className="min-h-11 rounded-lg border border-brand px-3 text-sm font-semibold text-brand disabled:opacity-50"
        >
          Reset demo
        </button>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={failureOn}
            disabled={pending}
            onChange={(event) => {
              const on = event.currentTarget.checked;
              run(
                () => setDemoFailureAction({ on }),
                () => setFailureOn(on),
              );
            }}
            className="size-5"
          />
          Simulate failure
        </label>
      </div>
      {(error || message) && (
        <p role="alert" className="mx-auto mt-2 max-w-7xl text-sm text-overdue">
          {error || message}
        </p>
      )}
    </aside>
  );
}
