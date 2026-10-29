"use client";

import { Chip } from "@/components/Chip";
import type { LostReason } from "@/modules/settings/types";

export function ReasonChips({
  reasons,
  value,
  onPick,
  disabled = false,
}: {
  reasons: Pick<LostReason, "id" | "name">[];
  value: string;
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-3 text-sm font-semibold">Lost reason</legend>
      <div className="flex flex-wrap gap-2">
        {reasons.map((reason) => (
          <Chip
            key={reason.id}
            selected={value === reason.id}
            onClick={() => onPick(reason.id)}
          >
            {reason.name}
          </Chip>
        ))}
      </div>
    </fieldset>
  );
}
