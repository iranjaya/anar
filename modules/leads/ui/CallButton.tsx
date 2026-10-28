"use client";

import { Phone } from "lucide-react";
import { useRouter } from "next/navigation";

const style =
  "inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-call px-5 font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-call";

export function CallButton({
  leadId,
  phoneE164,
  phoneValid,
  slug,
}: {
  leadId: string;
  phoneE164: string | null;
  phoneValid: boolean;
  slug: string;
}) {
  const router = useRouter();
  if (!phoneValid || phoneE164 === null)
    return (
      <div>
        <button type="button" disabled className={`${style} opacity-50`}>
          Call
        </button>
        <p className="mt-1 text-sm text-muted">Phone needs review</p>
      </div>
    );
  return (
    <a
      href={`tel:${phoneE164}`}
      onClick={() => router.push(`/${slug}/leads/${leadId}?log=1`)}
      className={style}
    >
      <Phone className="size-4" aria-hidden="true" />
      Call
    </a>
  );
}
