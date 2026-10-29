"use client";

export function LoadError({
  onRetry,
  message = "Could not load this page. Try again.",
}: {
  onRetry: () => void;
  message?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <p role="alert" className="mb-4 text-overdue">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-14 rounded-xl bg-brand px-5 font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        Retry
      </button>
    </div>
  );
}
