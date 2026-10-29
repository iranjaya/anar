import type { ComponentProps } from "react";

export function AuthField({
  label,
  hint,
  id,
  ...props
}: ComponentProps<"input"> & { id: string; label: string; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        {...props}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="min-h-14 w-full rounded-xl border border-line-strong bg-surface px-4 text-base text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 disabled:opacity-50"
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-2 text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
