# S6.3: lead edit events

The integrator widens `lead_events_type_check` to also allow `fields_updated`
and `score_changed`, and regenerates the single initial migration. No new
table, column, index or grant.

`fields_updated` data is `{keys, systemKeys}`: the changed answer keys and which
of name, phone and email changed. It never holds old or new contact values.
`score_changed` data is `{from, to, score}` and is written only when the
priority changes.

No backfill: existing rows only hold `imported` and `duplicate_import`.
