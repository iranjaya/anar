"use client";

import { useActionState, useEffect, useState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import { deactivateMemberAction } from "../actions";

export function RemoveMember({
  slug,
  memberId,
  name,
  openLeads,
  overdue,
  destinations,
}: {
  slug: string;
  memberId: string;
  name: string;
  openLeads: number;
  overdue: number;
  destinations: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [reassignTo, setReassignTo] = useState("");
  const [selectionVersion, setSelectionVersion] = useState(0);
  const storageKey = `anar:member-reassignment:${slug}:${memberId}`;
  const [state, action, pending] = useActionState(
    deactivateMemberAction.bind(null, slug, memberId),
    null,
  );
  useEffect(() => {
    if (state && !state.ok && state.reassignTo) setReassignTo(state.reassignTo);
  }, [state]);
  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) setReassignTo(saved);
  }, [storageKey]);
  useEffect(() => {
    if (state?.ok) sessionStorage.removeItem(storageKey);
  }, [state, storageKey]);
  return (
    <div className="min-w-0 lg:col-span-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Remove ${name} from the team`}
        className="min-h-11 rounded-lg border border-line-strong px-4 text-sm font-semibold text-overdue"
      >
        Remove from team
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`Remove ${name}`}
          className="mt-3 space-y-3 rounded-xl border border-line p-4"
        >
          <p className="text-sm">
            {openLeads} open {openLeads === 1 ? "lead" : "leads"}, {overdue}{" "}
            overdue.
          </p>
          <form action={action} aria-busy={pending} className="space-y-3">
            <label
              className="block text-sm font-semibold"
              htmlFor={`reassign-${memberId}`}
            >
              Move open leads to
            </label>
            <select
              key={selectionVersion}
              id={`reassign-${memberId}`}
              name="reassignTo"
              required
              value={reassignTo}
              onChange={(event) => {
                setReassignTo(event.target.value);
                sessionStorage.setItem(storageKey, event.target.value);
              }}
              className="min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3"
            >
              <option value="" disabled>
                Choose a destination
              </option>
              <option value="unassigned">Leave unassigned</option>
              {destinations.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={pending}
                className="min-h-11 rounded-lg bg-overdue px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending ? "Removing…" : "Confirm removal"}
              </button>
              <button
                type="button"
                onClick={() => {
                  sessionStorage.removeItem(storageKey);
                  setOpen(false);
                }}
                disabled={pending}
                className="min-h-11 rounded-lg border border-line-strong px-4 text-sm"
              >
                Cancel
              </button>
            </div>
            {state && !state.ok && (
              <p role="alert" className="text-sm text-overdue">
                {state.message}
              </p>
            )}
          </form>
          {state && !state.ok && state.error === "step_up_required" && (
            <FreshCodeForm
              enabled={!pending}
              onVerified={() => {
                setReassignTo(sessionStorage.getItem(storageKey) ?? "");
                setSelectionVersion((version) => version + 1);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
