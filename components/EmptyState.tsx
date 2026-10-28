export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-10 text-center">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {description && <p className="mt-2 text-muted">{description}</p>}
    </div>
  );
}
