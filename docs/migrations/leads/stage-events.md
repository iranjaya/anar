# S6.4: stage change events

The integrator widens `lead_events_type_check` to also allow `stage_changed`
and regenerates the single initial migration. No new table, column, index or
grant.

`stage_changed` data is `{from, to, fromKind, toKind, lostReasonId}`, with the
kinds as they were at the time, so later reports can count bookings as
non-won to won moves even after a stage is archived or renamed.

No backfill: no stored event has this type yet.
