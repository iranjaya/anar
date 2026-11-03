"use client";

import Link from "next/link";
import { useState } from "react";
import { FreshCodeForm } from "@/modules/auth/components";
import type {
  DryRun,
  DryRunResult,
  ImportResultRow,
  ImportRow,
  PreviewRow,
} from "../types";

const why: Record<string, string> = {
  resubmitted: "Same phone, new submission",
  same_submission: "Same phone, same submission",
  invalid_phone: "Phone needs review",
  duplicate_file: "Same phone earlier in this file",
  invalid: "Row has more cells than the header",
  imported: "New lead",
  error: "Could not be saved",
};

export function ImportRowList({
  slug,
  title,
  rows,
  total,
  leadLinks = true,
}: {
  slug: string;
  title: string;
  rows: (ImportRow | PreviewRow | ImportResultRow)[];
  total?: number;
  leadLinks?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className="min-w-0 rounded-2xl border border-line bg-surface p-5"
    >
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No rows in this group.</p>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="mt-4 hidden gap-3 border-b border-line pb-3 text-sm font-semibold text-muted lg:grid lg:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)_7rem]"
          >
            <span>Row</span>
            <span>Name</span>
            <span>Why</span>
            <span>Lead</span>
          </div>
          <ul aria-label={title} className="mt-2 divide-y divide-line">
            {rows.map((row) => (
              <li
                key={row.id}
                className="grid min-w-0 gap-2 py-4 lg:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)_7rem] lg:gap-3"
              >
                <span className="text-sm text-muted">Row {row.rowNo}</span>
                <div className="min-w-0 break-words">
                  <p className="font-semibold">
                    {"display" in row
                      ? (row.display.fullName ?? "No name")
                      : row.raw
                        ? (row.raw.full_name ?? "No name")
                        : "Source row expired"}
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-muted">
                    {("display" in row
                      ? row.display.phoneRaw
                      : (row.raw?.phone ?? row.phoneE164)) || "No phone"}
                  </p>
                </div>
                <p className="text-sm text-muted">
                  {why[row.reason ?? row.result] ?? "Phone needs review"}
                </p>
                {"display" in row || !leadLinks ? (
                  <p className="text-sm text-muted">
                    {row.leadId
                      ? "Lead detail available after the lead screen is enabled"
                      : "display" in row
                        ? "Available after import"
                        : "No lead for this row"}
                  </p>
                ) : row.leadId && row.raw ? (
                  <Link
                    href={`/${slug}/leads/${row.leadId}`}
                    aria-label={`Open lead from row ${row.rowNo}: ${row.raw.full_name}`}
                    className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline"
                  >
                    Open lead
                  </Link>
                ) : (
                  <p className="text-sm text-muted">Available after import</p>
                )}
              </li>
            ))}
          </ul>
          {total !== undefined && total > rows.length && (
            <p className="mt-3 text-sm text-muted">
              Showing first {rows.length} of {total}.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function CheckStep({
  slug,
  review,
  pending,
  error,
  templateName,
  changesSettings,
  stepUp,
  onBack,
  onImport,
  onImportReal,
}: {
  slug: string;
  review: DryRun | DryRunResult;
  pending: boolean;
  error: string;
  templateName: string | null;
  changesSettings: boolean;
  stepUp: boolean;
  onBack: () => void;
  onImport: () => void;
  onImportReal: (review: DryRunResult) => void;
}) {
  if ("counts" in review)
    return (
      <RealCheck
        slug={slug}
        review={review}
        pending={pending}
        error={error}
        templateName={templateName}
        needsCode={changesSettings || review.newOptions.length > 0}
        stepUp={stepUp}
        onBack={onBack}
        onImport={() => onImportReal(review)}
      />
    );
  const alreadyIn = review.sameSubmission + review.resubmitted.length;
  const total = alreadyIn + review.toAdd + review.duplicateFile.length;
  return (
    <div className="grid min-w-0 items-start gap-6 pb-16 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:pb-0">
      <section
        aria-label="Import check summary"
        className="min-w-0 rounded-2xl border border-line bg-surface p-5"
      >
        <h2 className="font-display text-3xl font-bold">
          {alreadyIn} already in, {review.toAdd} new
        </h2>
        <div
          role="img"
          aria-label={`${review.toAdd} new out of ${total} rows`}
          className="mt-5 h-3 overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full bg-brand"
            style={{ width: `${(review.toAdd / total) * 100}%` }}
          />
        </div>
        <dl className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 text-sm">
          <dt>Same submission, skipped</dt>
          <dd className="font-semibold">{review.sameSubmission}</dd>
          <dt>New submission, already in</dt>
          <dd className="font-semibold">{review.resubmitted.length}</dd>
          <dt>Duplicates in this file, skipped</dt>
          <dd className="font-semibold">{review.duplicateFile.length}</dd>
          <dt>Will import, needs phone review</dt>
          <dd className="font-semibold">{review.needPhoneReview}</dd>
        </dl>
        <p className="mt-5 text-sm text-muted">
          New leads will be unassigned. Phone review is included in the new
          leads.
        </p>
        {templateName && (
          <p className="mt-3 break-words text-sm text-muted">
            Save mapping as {templateName}.
          </p>
        )}
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:static lg:mt-6 lg:border-0 lg:p-0">
          {error && (
            <p role="alert" className="mb-3 text-sm text-overdue">
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={onBack}
              className="min-h-14 rounded-xl border border-brand px-4 font-semibold text-brand disabled:opacity-50"
            >
              Back to columns
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onImport}
              className="min-h-14 rounded-xl bg-brand px-4 font-semibold text-surface disabled:opacity-50"
            >
              {pending ? "Importing…" : `Import ${review.toAdd} leads`}
            </button>
          </div>
        </div>
      </section>
      <div className="min-w-0 space-y-6">
        <ImportRowList
          slug={slug}
          title="New submissions from existing leads"
          rows={review.resubmitted}
        />
        <ImportRowList
          slug={slug}
          title="Will import, needs phone review"
          rows={review.phoneReview}
        />
      </div>
    </div>
  );
}

function RealCheck({
  slug,
  review,
  pending,
  error,
  templateName,
  needsCode,
  stepUp,
  onBack,
  onImport,
}: {
  slug: string;
  review: DryRunResult;
  pending: boolean;
  error: string;
  templateName: string | null;
  needsCode: boolean;
  stepUp: boolean;
  onBack: () => void;
  onImport: () => void;
}) {
  const { counts } = review;
  const alreadyIn = review.sameSubmission + counts.resubmitted;
  const share = counts.rowCount === 0 ? 0 : review.toAdd / counts.rowCount;
  return (
    <div className="grid min-w-0 items-start gap-6 pb-16 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:pb-0">
      <section
        aria-label="Import check summary"
        className="min-w-0 rounded-2xl border border-line bg-surface p-5"
      >
        <h2 className="font-display text-3xl font-bold">
          {alreadyIn} already in, {review.toAdd} new
        </h2>
        <div
          role="img"
          aria-label={`${review.toAdd} new out of ${counts.rowCount} rows`}
          className="mt-5 h-3 overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full bg-brand"
            style={{ width: `${share * 100}%` }}
          />
        </div>
        <dl className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 text-sm">
          <dt>Rows in the file</dt>
          <dd className="font-semibold">{counts.rowCount}</dd>
          <dt>Same submission, skipped</dt>
          <dd className="font-semibold">{review.sameSubmission}</dd>
          <dt>New submission, already in</dt>
          <dd className="font-semibold">{counts.resubmitted}</dd>
          <dt>Duplicates in this file, skipped</dt>
          <dd className="font-semibold">{counts.duplicateFile}</dd>
          <dt>Rows that can't be read</dt>
          <dd className="font-semibold">{counts.invalid}</dd>
          <dt>Will import, needs phone review</dt>
          <dd className="font-semibold">{review.needPhoneReview}</dd>
        </dl>
        <p className="mt-5 text-sm text-muted">
          New leads will be unassigned. Phone review is included in the new
          leads.
        </p>
        {templateName && (
          <p className="mt-3 break-words text-sm text-muted">
            Save mapping as {templateName}.
          </p>
        )}
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:static lg:mt-6 lg:border-0 lg:p-0">
          {error && (
            <p role="alert" className="mb-3 text-sm text-overdue">
              {error}
            </p>
          )}
          {stepUp && <FreshCodeForm enabled={!pending} />}
          {needsCode && (
            <p id="import-code" className="mb-3 text-sm text-muted">
              This import adds company fields or answers, so it asks for a fresh
              code.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={onBack}
              className="min-h-14 rounded-xl border border-brand px-4 font-semibold text-brand disabled:opacity-50"
            >
              Back to columns
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onImport}
              aria-describedby={needsCode ? "import-code" : undefined}
              className="min-h-14 rounded-xl bg-brand px-4 font-semibold text-surface disabled:opacity-50"
            >
              {pending ? "Starting…" : `Import ${review.toAdd} leads`}
            </button>
          </div>
        </div>
      </section>
      <div className="min-w-0 space-y-6">
        <ImportRowList
          slug={slug}
          title="New submissions from existing leads"
          rows={review.resubmitted}
          total={counts.resubmitted}
        />
        <ImportRowList
          slug={slug}
          title="Will import, needs phone review"
          rows={review.phoneReview}
          total={review.needPhoneReview}
        />
        <ImportRowList
          slug={slug}
          title="Duplicates in this file"
          rows={review.duplicateFile}
          total={counts.duplicateFile}
        />
        <ImportRowList
          slug={slug}
          title="Rows that can't be read"
          rows={review.invalidRows}
          total={counts.invalid}
        />
        <NewAnswers options={review.newOptions} />
      </div>
    </div>
  );
}

const answerPage = 50;

function NewAnswers({ options }: { options: DryRunResult["newOptions"] }) {
  const [shown, setShown] = useState(answerPage);
  if (options.length === 0) return null;
  return (
    <section
      aria-label="New answers"
      className="min-w-0 rounded-2xl border border-line bg-surface p-5"
    >
      <h2 className="font-display text-xl font-bold">New answers</h2>
      <p className="mt-1 text-sm text-muted">
        These are added to the company fields when you import.
      </p>
      <ul aria-label="New answers" className="mt-2 divide-y divide-line">
        {options.slice(0, shown).map(({ fieldKey, option }) => (
          <li
            key={`${fieldKey}:${option.value}`}
            className="grid min-w-0 gap-1 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          >
            <span className="break-words font-semibold">{option.label}</span>
            <span className="break-all font-mono text-xs text-muted">
              {fieldKey}: {option.value}
            </span>
          </li>
        ))}
      </ul>
      {options.length > shown && (
        <button
          type="button"
          onClick={() => setShown(shown + answerPage)}
          className="mt-3 min-h-11 text-sm font-semibold text-brand underline"
        >
          Show more answers ({options.length - shown} left)
        </button>
      )}
    </section>
  );
}
