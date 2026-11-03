"use client";

export type Choice = { id: string; value: string; label: string };
export const blankChoice = (): Choice => ({
  id: crypto.randomUUID(),
  value: "",
  label: "",
});
export const inputClass =
  "min-h-12 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-4 outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50";

export function DefinitionInputs({
  id,
  pending,
  type,
  onType,
  choices,
  onChoices,
}: {
  id: string;
  pending: boolean;
  type: string;
  onType(type: string): void;
  choices: Choice[];
  onChoices(choices: Choice[]): void;
}) {
  const change = (index: number, update: Partial<Choice>) =>
    onChoices(
      choices.map((choice, at) =>
        at === index ? { ...choice, ...update } : choice,
      ),
    );
  return (
    <>
      <div>
        <label
          htmlFor={`${id}-type`}
          className="mb-2 block text-sm font-semibold"
        >
          Type
        </label>
        <select
          id={`${id}-type`}
          name="type"
          value={type}
          onChange={(event) => onType(event.target.value)}
          disabled={pending}
          className={inputClass}
        >
          <option value="dropdown">Choices</option>
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="date">Date</option>
        </select>
      </div>
      {type === "dropdown" && (
        <fieldset className="min-w-0 space-y-3">
          <legend className="mb-2 text-sm font-semibold">Choices</legend>
          {choices.map((choice, index) => (
            <div
              key={choice.id}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"
            >
              <input
                name="optionValue"
                aria-label={`Code ${index + 1}`}
                placeholder="Code"
                value={choice.value}
                onChange={(event) =>
                  change(index, { value: event.target.value })
                }
                maxLength={120}
                required
                disabled={pending}
                className={`${inputClass} font-mono`}
              />
              <input
                name="optionLabel"
                aria-label={`Label ${index + 1}`}
                placeholder="Label"
                value={choice.label}
                onChange={(event) =>
                  change(index, { label: event.target.value })
                }
                maxLength={120}
                required
                disabled={pending}
                className={inputClass}
              />
              <button
                type="button"
                aria-label={`Remove choice ${index + 1}`}
                onClick={() =>
                  onChoices(choices.filter((_, at) => at !== index))
                }
                disabled={pending || choices.length === 1}
                className="min-h-12 rounded-xl border border-line-strong px-3 text-sm font-semibold text-muted disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChoices([...choices, blankChoice()])}
            disabled={pending || choices.length >= 200}
            className="min-h-11 text-sm font-semibold text-brand underline underline-offset-4 disabled:opacity-50"
          >
            Add a choice
          </button>
        </fieldset>
      )}
    </>
  );
}
