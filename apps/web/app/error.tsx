"use client";

import { LoadError } from "@/components/LoadError";
import { PageShell } from "@/components/PageShell";

export default function ErrorPage({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <PageShell>
      <LoadError message="Couldn't load this page" onRetry={retry} />
    </PageShell>
  );
}
