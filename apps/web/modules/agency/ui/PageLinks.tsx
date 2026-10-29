import Link from "next/link";

export function PageLinks({
  path,
  hasCursor,
  nextCursor,
}: {
  path: "/agency/staff" | "/agency/invites" | "/agency/companies";
  hasCursor: boolean;
  nextCursor: string | null;
}) {
  return (
    <nav aria-label="List pages" className="flex flex-wrap gap-6">
      {hasCursor && (
        <Link
          href={path}
          className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
        >
          Newest
        </Link>
      )}
      {nextCursor && (
        <Link
          href={`${path}?cursor=${encodeURIComponent(nextCursor)}`}
          className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
        >
          Older
        </Link>
      )}
    </nav>
  );
}
