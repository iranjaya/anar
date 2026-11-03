"use client";

import type { Field } from "@/modules/settings/types";
import type { Mapping, NewField } from "../types";

export type MappingProps = {
  headers: string[];
  sample: string[][];
  mapping: Mapping;
  fields: Field[];
  newFields: NewField[];
  onMap: (header: string, value: string) => void;
  onFieldChange: (header: string, patch: Partial<NewField>) => void;
};

function MappingTarget({
  header,
  mapping,
  fields,
  newFields,
  onMap,
}: Pick<MappingProps, "mapping" | "fields" | "newFields" | "onMap"> & {
  header: string;
}) {
  const target = mapping.find((row) => row.header === header)?.target ?? "skip";
  const added = newFields.find((field) => field.header === header);
  return (
    <label
      className="block text-sm font-semibold"
      htmlFor={`mapping-${header}`}
    >
      Map column
      <select
        id={`mapping-${header}`}
        aria-label={`Map ${header}`}
        value={added ? "new" : target}
        onChange={(event) => onMap(header, event.currentTarget.value)}
        className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-2 text-base"
      >
        <optgroup label="Lead fields">
          {[
            ["full_name", "Name"],
            ["phone", "Phone"],
            ["email", "Email"],
            ["lead_date", "Lead date"],
            ["campaign_name", "Campaign"],
            ["form_name", "Form name"],
            ["source", "Source"],
          ].map(([key, label]) => (
            <option key={key} value={`system:${key}`}>
              {label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Company fields">
          {fields.map((field) => (
            <option key={field.id} value={`field:${field.key}`}>
              {field.label}
            </option>
          ))}
        </optgroup>
        {target.startsWith("field:") &&
          !added &&
          !fields.some((field) => `field:${field.key}` === target) && (
            <option value={target} disabled>
              Field no longer active
            </option>
          )}
        <option value="new">New field</option>
        <option value="skip">Skip column</option>
      </select>
    </label>
  );
}

function NewFieldEditor({
  field,
  values,
  onFieldChange,
}: {
  field?: NewField;
  values: string[];
  onFieldChange: MappingProps["onFieldChange"];
}) {
  if (!field) return null;
  const change = (patch: Partial<NewField>) =>
    onFieldChange(field.header, patch);
  const inputClass =
    "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 text-base";
  return (
    <fieldset className="mt-4 min-w-0 space-y-3">
      <legend className="font-semibold">New field</legend>
      <label className="block text-sm" htmlFor={`field-key-${field.header}`}>
        Key
        <input
          id={`field-key-${field.header}`}
          value={field.key}
          onChange={(event) => change({ key: event.currentTarget.value })}
          className={inputClass}
        />
      </label>
      <label className="block text-sm" htmlFor={`field-label-${field.header}`}>
        Label
        <input
          id={`field-label-${field.header}`}
          value={field.label}
          onChange={(event) => change({ label: event.currentTarget.value })}
          className={inputClass}
        />
      </label>
      <label className="block text-sm" htmlFor={`field-type-${field.header}`}>
        Type
        <select
          id={`field-type-${field.header}`}
          value={field.type}
          onChange={(event) => {
            const type = event.currentTarget.value as NewField["type"];
            let options = field.options;
            if (type === "dropdown" && !options?.length) {
              options = Array.from(new Set(values.filter(Boolean))).map(
                (value) => ({ value, label: value }),
              );
            }
            change({ type, options });
          }}
          className={inputClass}
        >
          {["text", "number", "date", "dropdown"].map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      {field.type === "dropdown" &&
        field.options?.map((option, index) => (
          <label
            key={option.value}
            className="block text-sm"
            htmlFor={`field-option-${field.header}-${index}`}
          >
            <span className="break-all font-mono">{option.value}</span>
            <input
              id={`field-option-${field.header}-${index}`}
              aria-label={`Label for ${option.value}`}
              value={option.label}
              onChange={(event) =>
                change({
                  options: field.options?.map((current, currentIndex) =>
                    currentIndex === index
                      ? { ...current, label: event.currentTarget.value }
                      : current,
                  ),
                })
              }
              className={inputClass}
            />
          </label>
        ))}
    </fieldset>
  );
}

export function MappingRows(props: MappingProps) {
  return (
    <div className="min-w-0 lg:rounded-2xl lg:border lg:border-line lg:bg-surface">
      <table className="block w-full text-left lg:table lg:table-fixed">
        <caption className="sr-only">Match CSV columns to lead fields</caption>
        <thead className="sr-only lg:not-sr-only lg:table-header-group">
          <tr className="border-b border-line text-sm text-muted">
            <th className="w-1/3 p-4" scope="col">
              CSV column and sample
            </th>
            <th className="p-4" scope="col">
              Match to
            </th>
            <th className="w-2/5 p-4" scope="col">
              New field
            </th>
          </tr>
        </thead>
        <tbody className="block space-y-4 lg:table-row-group lg:space-y-0">
          {props.headers.map((header, index) => (
            <tr
              key={header}
              className="block min-w-0 rounded-2xl border border-line bg-surface p-4 align-top lg:table-row lg:rounded-none lg:border-x-0 lg:border-t-0 lg:p-0 lg:last:border-b-0"
            >
              <th
                scope="row"
                className="block font-normal lg:table-cell lg:p-4"
              >
                <h2 className="break-all font-mono text-sm font-semibold">
                  {header}
                </h2>
                <p className="mt-2 break-all text-sm text-muted">
                  Sample: {props.sample[0]?.[index] || "No value"}
                </p>
                {header === "phone" && (
                  <p className="mt-2 text-sm text-muted">Phone kept as is.</p>
                )}
              </th>
              <td className="mt-4 block lg:mt-0 lg:table-cell lg:p-4">
                <MappingTarget {...props} header={header} />
              </td>
              <td className="block lg:table-cell lg:p-4">
                <NewFieldEditor
                  field={props.newFields.find(
                    (field) => field.header === header,
                  )}
                  values={props.sample.map((row) => row[index])}
                  onFieldChange={props.onFieldChange}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
