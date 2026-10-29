import Link from "next/link";
import type { ReactNode } from "react";

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-8 lg:grid lg:grid-cols-[1fr_1.2fr] lg:items-center lg:gap-20 lg:px-8 lg:py-16">
      <header className="mb-8 lg:mb-0">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center gap-3 font-display text-2xl font-bold text-brand"
        >
          <span aria-hidden="true" className="size-3 rounded-full bg-brand" />
          Anar
        </Link>
        <p className="mt-4 max-w-xs text-muted lg:text-lg">
          Your leads, follow-ups and team, in one place.
        </p>
        <p className="mt-8 hidden max-w-xs text-sm text-muted lg:block">
          Use the email address your company invited. No password to remember.
        </p>
      </header>
      <section className="min-w-0 rounded-2xl border border-line bg-surface p-5 lg:p-8">
        {children}
      </section>
    </main>
  );
}
