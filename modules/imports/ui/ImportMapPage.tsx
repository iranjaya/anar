"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import type { Field } from "@/modules/settings/types";
import type { Mapping, NewField, UploadResult } from "../types";
import { ImportRail } from "./ImportRail";
import { type MappingProps, MappingRows } from "./MappingRows";

export function ImportMapPage({
  slug,
  upload,
  fields,
}: {
  slug: string;
  upload: UploadResult;
  fields: Field[];
}) {
  const router = useRouter();
  const [mapping, setMapping] = useState<Mapping>(upload.suggestedMapping);
  const [newFields, setNewFields] = useState<NewField[]>(upload.proposedFields);
  const [saveTemplate, setSaveTemplate] = useState(false);
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
        <h1 className="font-display text-3xl font-bold">Match columns</h1>
        <p className="mt-2 text-muted">
          Choose where each column goes. Answer codes stay unchanged.
        </p>
      </header>
      <div className="min-w-0 lg:flex lg:gap-8">
        <ImportRail step={2} />
        <div className="min-w-0 flex-1">
          <MappingRows {...props} />
          <label className="mt-5 flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={saveTemplate}
              onChange={(event) => setSaveTemplate(event.currentTarget.checked)}
              className="size-5"
            />
            Save this mapping for next time
          </label>
          {reason && <p className="mt-3 text-sm text-muted">{reason}</p>}
          <button
            type="button"
            disabled={Boolean(reason)}
            onClick={() =>
              router.push(`/${slug}/imports/${upload.batchId}/map?step=check`)
            }
            className="mt-4 min-h-14 w-full rounded-xl bg-brand px-5 font-semibold text-surface disabled:opacity-50 lg:w-auto lg:min-w-64"
          >
            Check {upload.rowCount} rows
          </button>
        </div>
      </div>
    </PageShell>
  );
}
