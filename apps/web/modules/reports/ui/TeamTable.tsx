"use client";

import { Fragment, type ReactNode, useId, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import type { TeamOverview } from "../types";

export function TeamTable({
  members,
  panels,
  rangeLabel,
}: {
  members: TeamOverview["perMember"];
  panels: Record<string, ReactNode>;
  rangeLabel: string;
}) {
  type Row = TeamOverview["perMember"][number];
  const id = useId();
  const [sort, setSort] = useState<keyof Row>("name");
  const [ascending, setAscending] = useState(true);
  const sortDirection = ascending ? "ascending" : "descending";
  const [expanded, setExpanded] = useState<string | null>(null);
  const columns: { key: keyof Row; label: string }[] = [
    { key: "name", label: "Person" },
    { key: "leadsHeld", label: "Leads held · now" },
    { key: "calls", label: `Calls ${rangeLabel}` },
    { key: "overdue", label: "Overdue · now" },
    { key: "siteVisits", label: `Site visits ${rangeLabel}` },
    { key: "bookings", label: `Bookings ${rangeLabel}` },
    { key: "hotIdle2d", label: "Hot idle 2 days · now" },
  ];
  const rows = [...members].sort((a, b) => {
    const left = a[sort];
    const right = b[sort];
    const order =
      typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right)
        : Number(left) - Number(right);
    return ascending ? order : -order;
  });
  return (
    <section
      aria-label="Team performance"
      className="min-w-0 rounded-2xl border border-line bg-surface p-4"
    >
      <h2 className="mb-3 font-display text-xl font-bold">
        Team · {rangeLabel}
      </h2>
      <table className="block w-full min-w-0 text-left text-sm">
        <thead className="block">
          <tr className="grid grid-cols-2 gap-2 border-b border-line pb-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(6,minmax(0,1fr))]">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={sort === column.key ? sortDirection : "none"}
                className="min-w-0"
              >
                <button
                  type="button"
                  className="min-h-11 w-full break-words text-left text-muted"
                  onClick={() => {
                    setAscending(
                      sort === column.key ? !ascending : column.key === "name",
                    );
                    setSort(column.key);
                  }}
                >
                  {column.label}
                  {sort === column.key && (ascending ? " ↑" : " ↓")}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block">
          {rows.map((member) => (
            <Fragment key={member.memberId}>
              <tr className="grid grid-cols-2 items-center gap-2 border-b border-line py-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(6,minmax(0,1fr))]">
                <th scope="row" className="col-span-2 min-w-0 lg:col-span-1">
                  <button
                    type="button"
                    aria-expanded={expanded === member.memberId}
                    aria-controls={`${id}-${member.memberId}`}
                    onClick={() =>
                      setExpanded(
                        expanded === member.memberId ? null : member.memberId,
                      )
                    }
                    className="min-h-11 break-words text-left font-semibold text-brand underline"
                  >
                    {member.name}
                  </button>
                </th>
                {columns.slice(1).map((column) => (
                  <td
                    key={column.key}
                    className={
                      column.key === "overdue"
                        ? "min-w-0 text-overdue"
                        : "min-w-0"
                    }
                  >
                    <span className="block text-xs text-muted lg:hidden">
                      {column.label}
                    </span>
                    {member[column.key]}
                    {column.key === "calls" &&
                      member.callsTarget !== null &&
                      ` / ${member.callsTarget}`}
                  </td>
                ))}
              </tr>
              <tr
                id={`${id}-${member.memberId}`}
                hidden={expanded !== member.memberId}
                className={
                  expanded === member.memberId ? "block py-3" : undefined
                }
              >
                <td colSpan={7} className="block">
                  {panels[member.memberId]}
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      {members.length === 0 && <EmptyState title="No salespeople yet" />}
    </section>
  );
}
