# S7.1: assignment events

The integrator widens `lead_events_type_check` to also allow `assigned` and
`unassigned` and regenerates the single initial migration. No new table,
column, index or grant.

Both carry `{assignmentId, from, to}`: one `assignmentId` is shared by every
lead moved in the same operation, so a bulk hand-off reads as one action.
`assigned` always has a member in `to`; `unassigned` always has `to: null`.

No backfill: no stored event has these types yet.
