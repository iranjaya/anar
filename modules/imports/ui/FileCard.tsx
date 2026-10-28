"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatDay } from "@/lib/dates";
import type { ActionResult } from "@/lib/errors";
import { enterCompanyAction } from "@/modules/companies/actions";
import type { Company } from "@/modules/tenant/types";
import type { UploadResult } from "../types";

export function FileCard({
  companyId,
  slug,
  companies,
}: {
  companyId: string;
  slug: string;
  companies: Company[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [pickedFile, setPickedFile] = useState<{
    fileName: string;
    fileSize: number;
  } | null>(null);
  const [error, setError] = useState<{
    message: string;
    canRetry: boolean;
  } | null>(null);

  function uploadFile(file: { fileName: string; fileSize: number }) {
    setPickedFile(file);
    setUpload(null);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/imports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug,
            fileName: file.fileName,
            fileSize: file.fileSize,
          }),
        });
        const result: ActionResult<UploadResult> = await response.json();
        if (!result.ok) {
          setError({ message: result.message, canRetry: true });
          return;
        }
        setUpload({
          ...result.data,
          dateRange: {
            from: new Date(result.data.dateRange.from),
            to: new Date(result.data.dateRange.to),
          },
        });
      } catch {
        setError({
          message: "Couldn't upload this file. Try again.",
          canRetry: true,
        });
      }
    });
  }

  const mapUrl = upload ? `/${slug}/imports/${upload.batchId}/map` : "";
  return (
    <section
      aria-label="Import file"
      className="grid min-w-0 items-start gap-6 lg:grid-cols-2"
    >
      <section
        aria-label="Company and file"
        className="min-w-0 space-y-5 rounded-2xl border border-line bg-surface p-5"
      >
        <label className="block font-semibold">
          Company
          <select
            value={companyId}
            disabled={pending}
            onChange={(event) => {
              const companyId = event.currentTarget.value;
              setError(null);
              startTransition(async () => {
                try {
                  const result = await enterCompanyAction({ companyId });
                  if (!result.ok) {
                    setError({ message: result.message, canRetry: false });
                    return;
                  }
                  router.push(result.data.redirectTo);
                  router.refresh();
                } catch {
                  setError({
                    message: "Couldn't switch companies. Try again.",
                    canRetry: false,
                  });
                }
              });
            }}
            className="mt-2 min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-base"
          >
            {companies.map((company) => (
              <option
                key={company.id}
                value={company.id}
                disabled={company.status !== "active"}
              >
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <label className="block font-semibold" htmlFor="meta-file">
            Meta CSV file
          </label>
          <input
            id="meta-file"
            type="file"
            accept=".csv,text/csv,text/tab-separated-values"
            disabled={pending}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file)
                uploadFile({ fileName: file.name, fileSize: file.size });
            }}
            className="mt-2 block min-h-11 w-full min-w-0 text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-brand file:bg-surface file:px-3 file:font-semibold file:text-brand"
          />
          <p className="mt-2 text-sm text-muted">
            This demo uses a fictional company export. Your file contents are
            not read.
          </p>
        </div>
        {pending && (
          <p role="status" className="text-muted">
            Loading your file…
          </p>
        )}
        {error && (
          <div className="space-y-3">
            <p role="alert" className="text-overdue">
              {error.message}
            </p>
            {error.canRetry && pickedFile && (
              <button
                type="button"
                disabled={pending}
                onClick={() => uploadFile(pickedFile)}
                className="min-h-14 w-full rounded-xl bg-brand px-5 font-semibold text-surface disabled:opacity-50"
              >
                Retry upload
              </button>
            )}
          </div>
        )}
      </section>
      <section
        aria-labelledby="file-details-title"
        className="min-w-0 space-y-4 rounded-2xl border border-line bg-surface p-5"
      >
        <h2 id="file-details-title" className="font-display text-xl font-bold">
          What the file holds
        </h2>
        {!upload && (
          <p className="text-sm text-muted">
            Choose a file to see its rows, columns, lead dates and saved
            mapping.
          </p>
        )}
        {upload && pickedFile && (
          <>
            <p className="break-all font-mono text-sm">{pickedFile.fileName}</p>
            <p className="text-sm text-muted">
              {upload.rowCount} rows · {upload.headers.length} columns
            </p>
            <p className="text-sm text-muted">UTF-16 LE · Tab separated</p>
            <p className="text-sm text-muted">
              Lead dates: {formatDay(upload.dateRange.from)} to{" "}
              {formatDay(upload.dateRange.to)}
            </p>
            {upload.matchedTemplate && (
              <div className="rounded-xl bg-brand-soft p-4">
                <h2 className="font-semibold text-brand">
                  Saved mapping found
                </h2>
                <p className="mt-1 text-sm">{upload.matchedTemplate.name}</p>
              </div>
            )}
            <Link
              href={upload.matchedTemplate ? `${mapUrl}?step=check` : mapUrl}
              className="flex min-h-14 items-center justify-center rounded-xl bg-brand px-5 text-center font-semibold text-surface"
            >
              {upload.matchedTemplate
                ? `Check ${upload.rowCount} rows`
                : "Match columns"}
            </Link>
            {upload.matchedTemplate && (
              <Link
                href={mapUrl}
                className="flex min-h-11 items-center justify-center font-semibold text-brand underline"
              >
                Review columns
              </Link>
            )}
          </>
        )}
      </section>
    </section>
  );
}
