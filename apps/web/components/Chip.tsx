import { cn } from "cn";
import type { ComponentProps } from "react";

export function Chip({
  selected = false,
  className,
  ...props
}: ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "min-h-11 rounded-full border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-brand bg-brand-soft text-brand"
          : "border-line-strong bg-surface text-muted",
        className,
      )}
      {...props}
    />
  );
}
