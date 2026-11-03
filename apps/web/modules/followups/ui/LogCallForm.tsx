"use client";

import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Chip } from "@/components/Chip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { localDateAfterDays, localDateAtTen } from "@/lib/dates";
import { ReasonChips } from "@/modules/leads/components";
import type { Lead } from "@/modules/leads/types";
import type { CompanySchema } from "@/modules/settings/types";
import { logFollowUpAction } from "../actions";

export function LogCallForm({
  lead,
  schema,
  admin,
  timezone,
}: {
  lead: Lead;
  schema: CompanySchema;
  admin: boolean;
  timezone: string;
}) {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const [outcomeId, setOutcomeId] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [pickingDate, setPickingDate] = useState(false);
  const [stageId, setStageId] = useState(lead.stageId);
  const [reason, setReason] = useState(lead.lostReasonId ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const requestId = useRef<string | null>(null);
  const lost =
    schema.stages.find((stage) => stage.id === stageId)?.kind === "lost";
  const advance = admin || pathname === `/${slug}/today`;
  let disabledReason = "";
  if (!outcomeId) disabledReason = "Pick an outcome";
  else if (lost && !reason) disabledReason = "Pick why it was lost";
  let saveLabel = advance ? "Save and next lead" : "Save";
  if (lost) saveLabel = "Mark as Lost";
  if (pending) saveLabel = "Saving…";

  function close() {
    const next = new URLSearchParams(query);
    next.delete("log");
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  function save() {
    setError("");
    requestId.current ??= crypto.randomUUID();
    const id = requestId.current;
    startTransition(async () => {
      try {
        const result = await logFollowUpAction({
          slug,
          requestId: id,
          leadId: lead.id,
          outcomeId,
          notes,
          nextActionAt: !lost && date ? localDateAtTen(date, timezone) : null,
          stageId,
          lostReasonId: lost ? reason : undefined,
        });
        if (!result.ok) {
          setError(result.message);
          if (result.error === "validation") requestId.current = null;
          return;
        }
        if (advance) {
          const next = result.data.nextLeadId;
          router.replace(
            next ? `/${slug}/today?lead=${next}` : `/${slug}/today`,
          );
        } else {
          close();
        }
        router.refresh();
      } catch {
        setError("Couldn't save this call. Try again.");
      }
    });
  }

  return (
    <Sheet
      open={query.get("log") === "1"}
      onOpenChange={(open) => !open && !pending && close()}
    >
      <SheetContent className="lg:inset-y-0 lg:left-auto lg:right-0 lg:mx-0 lg:h-dvh lg:max-h-dvh lg:w-[480px] lg:max-w-none lg:rounded-none">
        <SheetHeader>
          <SheetTitle>Log a call</SheetTitle>
          <SheetDescription>{lead.fullName ?? lead.phoneE164}</SheetDescription>
        </SheetHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending && !disabledReason) save();
          }}
        >
          <fieldset disabled={pending}>
            <legend className="mb-3 text-sm font-semibold">Outcome</legend>
            <div className="grid grid-cols-2 gap-2">
              {schema.outcomes.map((outcome) => (
                <Chip
                  key={outcome.id}
                  selected={outcomeId === outcome.id}
                  onClick={() => setOutcomeId(outcome.id)}
                >
                  {outcome.name}
                </Chip>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-2">
            <span className="text-sm font-semibold">Note</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={pending}
              maxLength={2000}
              rows={2}
              className="w-full rounded-xl border border-line-strong bg-surface p-3 focus-visible:outline-2 focus-visible:outline-brand"
            />
          </label>
          {!lost && (
            <fieldset disabled={pending}>
              <legend className="mb-3 text-sm font-semibold">
                Next follow-up
              </legend>
              <div className="flex flex-wrap gap-2 lg:flex-nowrap">
                {[
                  { label: "Tomorrow", days: 1 },
                  { label: "3 days", days: 3 },
                  { label: "1 week", days: 7 },
                ].map(({ label, days }) => {
                  const nextDate = localDateAfterDays(
                    new Date(),
                    days,
                    timezone,
                  );
                  return (
                    <Chip
                      key={label}
                      className="px-3"
                      selected={!pickingDate && date === nextDate}
                      onClick={() => {
                        setDate(nextDate);
                        setPickingDate(false);
                      }}
                    >
                      {label}
                    </Chip>
                  );
                })}
                <Chip
                  className="px-3"
                  selected={pickingDate}
                  onClick={() => setPickingDate(true)}
                >
                  Pick date
                </Chip>
              </div>
              {pickingDate && (
                <label className="mt-3 block space-y-2">
                  <span className="text-sm text-muted">
                    Follow-up date, 10:00
                  </span>
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    className="min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3"
                  />
                </label>
              )}
            </fieldset>
          )}
          <fieldset disabled={pending}>
            <legend className="mb-3 text-sm font-semibold">Stage</legend>
            <div className="flex flex-wrap gap-2">
              {schema.stages.map((stage) => (
                <Chip
                  key={stage.id}
                  selected={stageId === stage.id}
                  onClick={() => setStageId(stage.id)}
                >
                  {stage.name}
                </Chip>
              ))}
            </div>
          </fieldset>
          {lost && (
            <ReasonChips
              reasons={schema.lostReasons}
              value={reason}
              onPick={setReason}
              disabled={pending}
            />
          )}
          <div className="space-y-3 border-t border-line pt-4">
            {error && (
              <p role="alert" className="text-sm text-overdue">
                {error}
              </p>
            )}
            {disabledReason && (
              <p id="save-call-reason" className="text-sm text-muted">
                {disabledReason}
              </p>
            )}
            <button
              type="submit"
              disabled={pending || Boolean(disabledReason)}
              aria-describedby={disabledReason ? "save-call-reason" : undefined}
              className={`min-h-14 w-full rounded-xl px-5 font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 ${lost ? "bg-overdue" : "bg-brand"}`}
            >
              {saveLabel}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
