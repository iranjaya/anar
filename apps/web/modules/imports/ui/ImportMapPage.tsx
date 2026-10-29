"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { PageShell } from "@/components/PageShell";
import type { Field } from "@/modules/settings/types";
import { commitImportAction, dryRunImportAction } from "../actions";
import type { DryRun, Mapping, NewField, UploadResult } from "../types";
import { CheckStep } from "./CheckStep";
import { ImportRail } from "./ImportRail";
import { type MappingProps, MappingRows } from "./MappingRows";

export function ImportMapPage({
  slug,
  upload,
  fields,
  initialReview,
  templateName,
}: {
  slug: string;
  upload: UploadResult;
  fields: Field[];
  initialReview: DryRun | null;
  templateName: string;
}) {
  const router = useRouter();
  const checking = useSearchParams().get("step") === "check";
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [review, setReview] = useState(initialReview);
  const [mapping, setMapping] = useState<Mapping>(upload.suggestedMapping);
  const [newFields, setNewFields] = useState<NewField[]>(upload.proposedFields);
  const [saveTemplate, setSaveTemplate] = useState(false);
  const mapUrl = `/${slug}/imports/${upload.batchId}/map`;
  const report = review ?? initialReview;

  function checkColumns() {
    setError("");
    startTransition(async () => {
      try {
        const result = await dryRunImportAction({
          slug,
          batchId: upload.batchId,
          mapping,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setReview(result.data);
        router.push(`${mapUrl}?step=check`);
      } catch {
        setError("Couldn't check this file. Try again.");
      }
    });
  }

  function importLeads() {
    setError("");
    startTransition(async () => {
      try {
        const result = await commitImportAction({
          slug,
          batchId: upload.batchId,
          mapping,
          newFields,
          saveTemplate: saveTemplate ? { name: templateName } : undefined,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        router.push(`/${slug}/imports/${result.data.jobId}`);
      } catch {
        setError("Couldn't import these leads. Try again.");
      }
    });
  }
  const onMap: MappingProps["onMap"] = (header, value) => {
    let target = value as Mapping[number]["target"];
    if (value === "new") {
      const field = newFields.find((field) => field.header === header) ??
        upload.proposedFields.find((field) => field.header === header) ?? {
          header,
          key: header
            .replace(/[?_]+$/, "")
            .replace(/\W+/g, "_")
            .toLowerCase(),
          label: header.replace(/[?_]+$/, "").replace(/_/g, " "),
          type: "text" as const,
        };
      setNewFields((current) => [
        ...current.filter((field) => field.header !== header),
        field,
      ]);
      target = `field:${field.key}`;
    } else {
      setNewFields((current) =>
        current.filter((field) => field.header !== header),
      );
    }
    setMapping((current) =>
      current.map((row) => (row.header === header ? { ...row, target } : row)),
    );
  };
  const onFieldChange: MappingProps["onFieldChange"] = (header, patch) => {
    setNewFields((current) =>
      current.map((field) =>
        field.header === header ? { ...field, ...patch } : field,
      ),
    );
    if (patch.key !== undefined)
      setMapping((current) =>
        current.map((row) =>
          row.header === header
            ? { ...row, target: `field:${patch.key}` }
            : row,
        ),
      );
  };
  let reason = "";
  const keys = new Set(fields.map((field) => field.key));
  for (const field of newFields) {
    if (!/^[a-z][a-z0-9_]*$/.test(field.key) || !field.label.trim())
      reason = "Give each new field a valid key and label.";
    if (keys.has(field.key))
      reason =
        "New field keys must be unique. You can also select an existing company field.";
    if (
      field.type === "dropdown" &&
      (!field.options?.length ||
        field.options.some((option) => !option.label.trim()))
    )
      reason = "Give each dropdown option a label.";
    keys.add(field.key);
  }
  if (mapping.filter((row) => row.target === "system:phone").length !== 1)
    reason = "Match exactly one column to Phone.";
  const props: MappingProps = {
    headers: upload.headers,
    sample: upload.sample,
    mapping,
    fields,
    newFields,
    onMap,
    onFieldChange,
  };
  return (
    <PageShell wide>
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold">
          {checking ? "Check your import" : "Match columns"}
        </h1>
        <p className="mt-2 text-muted">
          {checking
            ? "Review what will be added and what is already in."
            : "Choose where each column goes. Answer codes stay unchanged."}
        </p>
      </header>
      <div className="min-w-0 lg:flex lg:gap-8">
        <ImportRail step={checking ? 3 : 2} />
        <div className="min-w-0 flex-1">
          {checking && report ? (
            <CheckStep
              slug={slug}
              review={report}
              pending={pending}
              error={error}
              templateName={saveTemplate ? templateName : null}
              onBack={() => {
                setError("");
                router.push(mapUrl);
              }}
              onImport={importLeads}
            />
          ) : (
            <>
              <fieldset disabled={pending} className="min-w-0">
                <MappingRows {...props} />
                <label className="mt-5 flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={saveTemplate}
                    onChange={(event) =>
                      setSaveTemplate(event.currentTarget.checked)
                    }
                    className="size-5"
                  />
                  Save this mapping for next time
                </label>
              </fieldset>
              {reason && <p className="mt-3 text-sm text-muted">{reason}</p>}
              {error && (
                <p role="alert" className="mt-3 text-sm text-overdue">
                  {error}
                </p>
              )}
              {pending && (
                <p role="status" className="mt-3 text-sm text-muted">
                  Checking your file…
                </p>
              )}
              <button
                type="button"
                disabled={pending || Boolean(reason)}
                onClick={checkColumns}
                className="mt-4 min-h-14 w-full rounded-xl bg-brand px-5 font-semibold text-surface disabled:opacity-50 lg:w-auto lg:min-w-64"
              >
                Check {upload.rowCount} rows
              </button>
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
