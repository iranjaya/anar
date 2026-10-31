export function ReadError({
  message,
  href,
}: {
  message: string;
  href: string;
}) {
  return (
    <div role="alert" className="rounded-2xl border border-line bg-surface p-6">
      <p className="text-overdue">{message}</p>
      <a
        href={href}
        className="mt-3 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
      >
        Try again
      </a>
    </div>
  );
}
