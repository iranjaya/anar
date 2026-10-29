import { formatDay } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import type { Lead, LeadDetail } from "../types";

export function Facts({
  lead,
  fields,
  now,
}: {
  lead: Lead;
  fields: LeadDetail["fields"];
  now: Date;
}) {
  const facts = [
    ["Phone", lead.phoneE164 ? formatPhone(lead.phoneE164) : lead.phoneRaw],
    ["Email", lead.email],
    ["Source", lead.source],
    ["Campaign", lead.campaignName],
    ["Form", lead.formName],
    ["Lead date", formatDay(lead.leadDate, now)],
    [
      "Last contacted",
      lead.lastContactedAt ? formatDay(lead.lastContactedAt, now) : null,
    ],
  ].filter(([, value]) => value !== null && value !== "");
  return (
    <>
      <section
        aria-label="Lead facts"
        className="rounded-2xl border border-line bg-surface p-5"
      >
        <h2 className="mb-4 font-display text-xl font-semibold">Lead facts</h2>
        <dl className="space-y-4">
          {facts.map(([label, value]) => (
            <div
              key={label}
              className="grid min-w-0 gap-1 lg:grid-cols-[8rem_minmax(0,1fr)]"
            >
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="min-w-0 break-words text-sm text-ink-2">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      {fields.length > 0 && (
        <section
          aria-label="Form answers"
          className="rounded-2xl border border-line bg-surface p-5"
        >
          <h2 className="mb-4 font-display text-xl font-semibold">
            Form answers
          </h2>
          <dl className="space-y-4">
            {fields.map((field) => (
              <div key={field.key}>
                <dt className="text-sm text-muted">{field.label}</dt>
                <dd className="mt-1 break-words font-medium text-ink-2">
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}
