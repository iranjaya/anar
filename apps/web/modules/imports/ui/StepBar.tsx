export function StepBar({ step }: { step: number }) {
  return (
    <ol
      aria-label="Import steps"
      className="grid grid-cols-4 gap-2 lg:grid-cols-1 lg:gap-5"
    >
      {["File", "Columns", "Check", "Done"].map((label, index) => (
        <li
          key={label}
          aria-current={index + 1 === step ? "step" : undefined}
          className={
            index + 1 === step ? "font-semibold text-brand" : "text-muted"
          }
        >
          <span className="mr-2 inline-flex size-7 items-center justify-center rounded-full border border-current text-sm">
            {index + 1}
          </span>
          <span className="text-sm">{label}</span>
        </li>
      ))}
    </ol>
  );
}
