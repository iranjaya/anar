"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { type ActionResult, actionFailure } from "@/lib/errors";
import { logout } from "../browser";

export function LogoutButton() {
  const router = useRouter();
  const [state, action, pending] = useActionState<
    ActionResult<void> | null,
    FormData
  >(async () => {
    try {
      await logout();
      router.replace("/login");
      router.refresh();
      return { ok: true, data: undefined };
    } catch (error) {
      return actionFailure(error);
    }
  }, null);
  return (
    <form action={action} aria-busy={pending}>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold text-brand disabled:opacity-50"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {state && !state.ok && (
        <p role="alert" className="mt-2 text-sm text-overdue">
          {state.message}
        </p>
      )}
    </form>
  );
}
