"use client";

import { useActionState } from "react";
import { markReadAction } from "../actions";

export function MarkRead({ slug, id }: { slug: string; id: string }) {
  const [state, action, pending] = useActionState(
    markReadAction.bind(null, slug, id),
    null,
  );
  return (
    <form action={action} aria-busy={pending}>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg border border-line-strong px-4 text-sm font-semibold text-brand disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving…" : "Mark read"}
      </button>
      {state && !state.ok && (
        <p role="alert" className="mt-1 text-sm text-overdue">
          {state.message}
        </p>
      )}
    </form>
  );
}
