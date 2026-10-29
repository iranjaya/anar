import Link from "next/link";
import type { TeamOverview } from "../types";

export function Tiles({
  tiles,
  slug,
}: {
  tiles: TeamOverview["tiles"];
  slug: string;
}) {
  const values = [
    { label: "New leads · today", value: tiles.newToday },
    { label: "Unassigned · now", value: tiles.unassigned },
    { label: "Overdue · now", value: tiles.overdue },
    { label: "Site visits · this week", value: tiles.siteVisitsThisWeek },
    { label: "Bookings · this month", value: tiles.bookingsThisMonth },
  ];
  return (
    <section
      aria-label="Team summary"
      className="grid grid-cols-2 gap-3 lg:grid-cols-5"
    >
      {values.map((tile, index) => (
        <article
          key={tile.label}
          className="min-w-0 rounded-2xl border border-line bg-surface p-4"
        >
          <h2 className="text-sm text-muted">{tile.label}</h2>
          <p className="mt-2 font-display text-3xl font-bold">{tile.value}</p>
          {index === 4 && tiles.bookingsTarget !== null && (
            <p className="text-sm text-muted">Target {tiles.bookingsTarget}</p>
          )}
          {index === 1 && (
            <>
              <Link
                href={`/${slug}/leads`}
                className="flex min-h-11 items-center font-semibold text-brand underline lg:hidden"
              >
                Assign leads
              </Link>
              <a
                href="#unassigned"
                className="hidden min-h-11 items-center font-semibold text-brand underline lg:flex"
              >
                Assign leads
              </a>
            </>
          )}
        </article>
      ))}
    </section>
  );
}
