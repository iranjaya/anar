"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { resumeImportAction } from "../actions";
import type { ImportReport } from "../types";

const pollMs = 5000;
const live = new Set(["queued", "running", "retrying"]);

// Reloads the server page every five seconds while the import is still working and the tab is open.
export function ImportProgress({
  slug,
  report,
}: {
  slug: string;
  report: ImportReport;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState("");
  function resumeImport() {
    setFailed("");
    startTransition(async () => {
      try {
        const result = await resumeImportAction({
          slug,
          batchId: report.id,
        });
        if (!result.ok) setFailed(result.message);
        else router.refresh();
      } catch {
        setFailed("Couldn't resume this import. Try again.");
      }
    });
  }
  const working = report.runState !== null && live.has(report.runState);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, pollMs);
    return () => clearInterval(timer);
  }, [working, router]);
  const { lastRowNo, rowCount } = report;
  const title =
    report.runState === "stopped"
      ? `Import stopped at row ${lastRowNo}`
      : report.runState === "queued"
        ? "Waiting to start"
        : "Importing";
  return (
    <section
      aria-label="Import progress"
      className="min-w-0 rounded-2xl border border-line bg-surface p-5"
    >
      <h2 className="font-display text-3xl font-bold">{title}</h2>
      <p className="mt-3 text-sm text-muted">
        {lastRowNo} of {rowCount} rows saved.
      </p>
      <div
        role="progressbar"
        aria-label="Rows saved"
        aria-valuemin={0}
        aria-valuemax={rowCount}
        aria-valuenow={lastRowNo}
        className="mt-4 h-3 overflow-hidden rounded-full bg-line"
      >
        <div
          className="h-full bg-brand"
          style={{
            width: `${rowCount === 0 ? 0 : (lastRowNo / rowCount) * 100}%`,
          }}
        />
      </div>
      {report.runState === "retrying" && (
        <p className="mt-3 text-sm text-muted">
          Something went wrong. It is trying again.
        </p>
      )}
      {report.error && (
        <p role="alert" className="mt-3 text-sm text-overdue">
          {report.error.message}
        </p>
      )}
      {working && (
        <p className="mt-3 text-sm text-muted">
          You can leave this page. The import keeps going.
        </p>
      )}
      {failed && (
        <p role="alert" className="mt-3 text-sm text-overdue">
          {failed}
        </p>
      )}
      {report.canResume && (
        <button
          type="button"
          disabled={pending}
          onClick={resumeImport}
          className="mt-5 min-h-14 w-full rounded-xl bg-brand px-4 font-semibold text-surface disabled:opacity-50"
        >
          {pending ? "Resuming…" : `Resume from row ${report.lastRowNo + 1}`}
        </button>
      )}
    </section>
  );
}
