import { StepBar } from "./StepBar";

export function ImportRail({ step }: { step: number }) {
  return (
    <aside
      aria-label="Import progress"
      className="mb-6 lg:mb-0 lg:w-44 lg:shrink-0"
    >
      <StepBar step={step} />
    </aside>
  );
}
