# Lost suggestion events

S8.3 adds `lost_suggestion_dismissed` to the `lead_events_type_check` constraint in the single pre-deploy initial migration. The event stores `{suggestionEventId}` and is written in the same transaction that clears the lead's pending suggestion. No table or data backfill is needed.
