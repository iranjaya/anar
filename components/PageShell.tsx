import { cn } from "cn";
import type { ComponentProps } from "react";

export function PageShell({
  wide = false,
  className,
  ...props
}: ComponentProps<"main"> & { wide?: boolean }) {
  return (
    <main
      className={cn(
        "mx-auto w-full min-w-0 px-4 pt-6 pb-[calc(7rem+env(safe-area-inset-bottom))]",
        wide ? "max-w-7xl" : "max-w-lg",
        className,
      )}
      {...props}
    />
  );
}
