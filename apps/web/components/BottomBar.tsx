import { cn } from "cn";
import type { ComponentProps } from "react";

export function BottomBar({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      {...props}
    >
      <div
        className={cn(
          "mx-auto flex max-w-lg items-center gap-3 [&>a]:min-h-14 [&>button]:min-h-14",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
