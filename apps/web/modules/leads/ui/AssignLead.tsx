"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { Member } from "@/modules/tenant/types";
import { assignLeadsRealAction } from "../editActions";

const unassign = "unassign";

export function AssignLead({
  slug,
  leadId,
  assignedTo,
  members,
}: {
  slug: string;
  leadId: string;
  assignedTo: string | null;
  members: Pick<Member, "id" | "name">[];
}) {
  const router = useRouter();
  const id = useId();
  const current = assignedTo ?? unassign;
  const [memberId, setMemberId] = useState(current);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    setError("");
    startTransition(async () => {
      const result = await assignLeadsRealAction({
        slug,
        leadIds: [leadId],
        memberId: memberId === unassign ? null : memberId,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section
      aria-label="Assign lead"
      className="space-y-3 rounded-2xl border border-line bg-surface p-5"
    >
      <label
        htmlFor={`${id}-member`}
        className="block font-display text-xl font-semibold"
      >
        Owner
      </label>
      <select
        id={`${id}-member`}
        value={memberId}
        disabled={pending}
        onChange={(event) => setMemberId(event.currentTarget.value)}
        className="min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-3 text-base"
      >
        <option value={unassign}>Unassigned</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="text-sm text-overdue">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={pending || memberId === current}
        className="min-h-12 w-full rounded-xl bg-brand px-4 font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save owner"}
      </button>
    </section>
  );
}
