"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { enterCompanyAction } from "../actions";

export function EnterCompanyButton({
  companyId,
  disabled,
}: {
  companyId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <div>
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => {
          setError("");
          startTransition(async () => {
            try {
              const result = await enterCompanyAction({ companyId });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              router.push(result.data.redirectTo);
              router.refresh();
            } catch {
              setError("Couldn't enter this company. Try again.");
            }
          });
        }}
        className="min-h-14 w-full rounded-xl bg-brand px-5 font-semibold text-surface disabled:opacity-50"
      >
        Enter company
      </button>
      {disabled && (
        <p className="mt-2 text-sm text-muted">This company is not active.</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-overdue">
          {error}
        </p>
      )}
    </div>
  );
}
