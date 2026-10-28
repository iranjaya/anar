"use client";

import { useRouter } from "next/navigation";
import { LoadError } from "@/components/LoadError";
import { PageShell } from "@/components/PageShell";

export function ShellError() {
  const router = useRouter();
  return (
    <PageShell>
      <LoadError
        message="Couldn't load this page"
        onRetry={() => router.refresh()}
      />
    </PageShell>
  );
}
