"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import { deactivateStaffAction } from "../actions";

export function RemoveStaff({
  staffId,
  name,
  self,
}: {
  staffId: string;
  name: string;
  self: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    deactivateStaffAction.bind(null, staffId),
    null,
  );
  useEffect(() => {
    if (state?.ok && self) router.replace("/login");
  }, [state, self, router]);
  if (!confirming)
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-11 rounded-lg border border-line-strong px-4 text-sm font-semibold text-overdue"
      >
        {self ? "Leave agency" : "Remove from agency"}
      </button>
    );
  return (
    <div className="min-w-0">
      <form action={action} aria-busy={pending} className="space-y-2">
        <p className="text-sm">
          {self
            ? "You will be signed out everywhere and lose access to this agency."
            : `${name} will be signed out everywhere and their pending invitations stop working.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-lg bg-overdue px-4 text-sm font-semibold text-surface disabled:opacity-50"
          >
            {pending ? "Removing…" : self ? "Yes, leave" : "Yes, remove"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
            className="min-h-11 rounded-lg border border-line-strong px-4 text-sm font-semibold text-brand disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {state && !state.ok && (
          <p role="alert" className="text-sm text-overdue">
            {state.message}
          </p>
        )}
      </form>
      {state && !state.ok && state.error === "step_up_required" && (
        <FreshCodeForm enabled={!pending} />
      )}
    </div>
  );
}
