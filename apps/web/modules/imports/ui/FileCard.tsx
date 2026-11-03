"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { parseApiResponse } from "@/lib/api/response";
import { formatDay } from "@/lib/dates";
import { type ActionResult, AppError } from "@/lib/errors";
import { enterCompanyAction } from "@/modules/companies/actions";
import type { Company } from "@/modules/tenant/types";
import { uploadResultSchema } from "../data/wire";
import type { UploadResult, UploadResultReal } from "../types";

type Props = { slug: string; timezone: string } & (
  | { mode: "demo"; companyId: string; companies: Company[] }
  | {
      mode: "real";
      companyName: string;
      canChangeCompany: boolean;
      initial: UploadResultReal | null;
    }
);

const encodings: Record<UploadResultReal["encoding"], string> = {
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  "windows-1252": "Windows-1252",
};
const delimiters: Record<UploadResultReal["delimiter"], string> = {
  ",": "Comma separated",
  "\t": "Tab separated",
  ";": "Semicolon separated",
  "|": "Pipe separated",
};

export function FileCard(props: Props) {
  const { slug } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [upload, setUpload] = useState<UploadResult | UploadResultReal | null>(
    props.mode === "real" ? props.initial : null,
  );
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [error, setError] = useState<{
    message: string;
    canRetry: boolean;
  } | null>(null);

  function uploadFile(file: File) {
    setPickedFile(file);
    setUpload(null);
    setError(null);
    if (props.mode === "real") {
      startTransition(async () => {
        try {
          const body = new FormData();
          body.append("file", file);
          const response = await fetch(
            `/api/imports?company=${encodeURIComponent(slug)}`,
            { method: "POST", body, signal: AbortSignal.timeout(120_000) },
          );
          const result = await parseApiResponse(response, uploadResultSchema);
          setUpload(result);
          router.replace(`/${slug}/imports/new?batch=${result.batchId}`, {
            scroll: false,
          });
        } catch (error) {
          setError({
            message:
              error instanceof AppError
                ? error.message
                : "Couldn't upload this file. Try again.",
            canRetry: true,
          });
        }
      });
      return;
    }
    startTransition(async () => {
      try {
        const response = await fetch("/api/imports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug,
            fileName: file.name,
            fileSize: file.size,
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
        {props.mode === "real" ? (
          <div>
            <p className="font-semibold">Company</p>
            <p className="mt-2 break-words">{props.companyName}</p>
            {props.canChangeCompany && (
              <Link
                href="/agency/companies"
                className="mt-1 inline-flex min-h-11 items-center font-semibold text-brand underline"
              >
                Change company
              </Link>
            )}
          </div>
        ) : (
          <label className="block font-semibold">
            Company
            <select
              value={props.companyId}
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
              {props.companies.map((company) => (
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
        )}
        <div>
          <label className="block font-semibold" htmlFor="meta-file">
            Meta CSV file
          </label>
          <input
            id="meta-file"
            type="file"
            accept=".csv,.txt,text/csv,text/plain,text/tab-separated-values"
            disabled={pending}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) uploadFile(file);
            }}
            className="mt-2 block min-h-11 w-full min-w-0 text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-brand file:bg-surface file:px-3 file:font-semibold file:text-brand"
          />
          {props.mode === "demo" && (
            <p className="mt-2 text-sm text-muted">
              This demo uses a fictional company export. Your file contents are
              not read.
            </p>
          )}
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
        {upload && "warnings" in upload && (
          <RealDetails slug={slug} upload={upload} timezone={props.timezone} />
        )}
        {upload && !("warnings" in upload) && pickedFile && (
          <>
            <p className="break-all font-mono text-sm">{pickedFile.name}</p>
            <p className="text-sm text-muted">
              {upload.rowCount} rows · {upload.headers.length} columns
            </p>
            <p className="text-sm text-muted">UTF-16 LE · Tab separated</p>
            <p className="text-sm text-muted">
              Lead dates: {formatDay(upload.dateRange.from, props.timezone)} to{" "}
              {formatDay(upload.dateRange.to, props.timezone)}
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

function RealDetails({
  slug,
  upload,
  timezone,
}: {
  slug: string;
  upload: UploadResultReal;
  timezone: string;
}) {
  return (
    <>
      <p className="break-all font-mono text-sm">{upload.fileName}</p>
      <p className="text-sm text-muted">
        {upload.rowCount} rows · {upload.headers.length} columns
      </p>
      <p className="text-sm text-muted">
        {encodings[upload.encoding]} · {delimiters[upload.delimiter]}
      </p>
      {upload.warnings.includes("encoding_fallback") && (
        <p className="text-sm text-overdue">
          Could not confirm the encoding. Check names in the preview.
        </p>
      )}
      <p className="text-sm text-muted">
        {upload.dateRange
          ? `Lead dates: ${formatDay(upload.dateRange.from, timezone)} to ${formatDay(upload.dateRange.to, timezone)}`
          : "No lead dates found in this file."}
      </p>
      {upload.matchedTemplate && (
        <div className="rounded-xl bg-brand-soft p-4">
          <h2 className="font-semibold text-brand">Saved mapping found</h2>
          <p className="mt-1 text-sm">{upload.matchedTemplate.name}</p>
        </div>
      )}
      <Link
        href={`/${slug}/imports/${upload.batchId}/map`}
        className="flex min-h-14 items-center justify-center rounded-xl bg-brand px-5 text-center font-semibold text-surface"
      >
        Match columns
      </Link>
    </>
  );
}
